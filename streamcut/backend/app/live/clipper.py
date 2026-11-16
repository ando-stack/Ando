"""Creación de clips durante la emisión.

- FULL_ANALYSIS: se extrae del buffer circular la ventana alrededor del momento, se transcribe y
  puntúa con el mismo motor que los vídeos importados, se deduplica frente a los clips de la
  sesión y se crea y renderiza el clip.
- PLATFORM_CLIPS: se crea un clip oficial con la API de Twitch y se guarda su referencia (y el
  archivo, solo si el endpoint oficial de descargas lo permite).
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import func, select

from app.analysis import audio as audio_mod
from app.analysis import chat as chat_mod
from app.analysis import semantic, transcribe
from app.analysis.scoring import Candidate, DetectionParams, Signals, generate_candidates
from app.core.config import get_settings
from app.core.netsafe import UnsafeURL, validate_public_http_url
from app.db.models import (
    Channel,
    Clip,
    HighlightCandidate,
    IngestionJob,
    SourceAsset,
    StreamSession,
    TranscriptSegment,
    utcnow,
)
from app.db.session import SessionLocal
from app.integrations.twitch import DOWNLOAD_SCOPES, TwitchError, get_twitch
from app.media import ffmpeg as ff
from app.services.bus import publish
from app.services.channels import user_connection, valid_user_token
from app.services.jobs import record_event, write_log
from app.services.pipeline import _store, create_clip_from_candidate
from app.services.settings import get_settings_data
from app.storage import get_storage, sha256_file, temp_dir

from .ingest import read_segment_list, session_dir

log = logging.getLogger(__name__)
PRE = 35.0
POST = 22.0


def autopilot_config(db, channel: Channel) -> dict[str, Any]:
    cfg = get_settings_data(db, channel.workspace_id)["autopilot"]
    return {**cfg, **(channel.autopilot or {})}


def make_live_clip(session_id: uuid.UUID, payload: dict[str, Any]) -> None:
    t_start = time.time()
    with SessionLocal() as db:
        session = db.get(StreamSession, session_id)
        if session is None:
            return
        channel = db.get(Channel, session.channel_id)
        ap = autopilot_config(db, channel)
        clips_so_far = db.scalar(select(func.count(Clip.id)).where(Clip.stream_session_id == session.id)) or 0
        if clips_so_far >= int(ap.get("max_clips_per_stream", 20)):
            record_event(db, workspace_id=session.workspace_id, type="limit_reached",
                         label="Límite de clips por directo alcanzado", channel_id=channel.id,
                         stream_session_id=session.id)
            db.commit()
            return
        directory = session_dir(str(session.id))
        segs = read_segment_list(directory, float(payload.get("wall_origin", 0)))
        peak = float(payload["peak"])
        a, b = peak - PRE, peak + POST
        chosen = [s for s in segs if s.end > a and s.start < b and s.path.exists()]
        if not chosen:
            write_log(session.workspace_id, "live", session.id, "warning",
                      "Los segmentos del momento ya no están en el buffer")
            return
        win_start = chosen[0].start
        win_len = min(b, chosen[-1].end) - max(a, win_start)
        offset_in_concat = max(0.0, a - win_start)
        storage = get_storage()
        asset_id = uuid.uuid4()
        with temp_dir("live-clip") as tmp:
            src = tmp / "window.mp4"
            ff.remux_concat([s.path for s in chosen], src, offset_in_concat, win_len)
            info = ff.probe(src)
            key = f"ws/{session.workspace_id}/originals/{asset_id}/live-{int(peak)}.mp4"
            size = storage.put_file(src, key, "video/mp4")
            asset = SourceAsset(id=asset_id, workspace_id=session.workspace_id, kind="live_recording", status="ready",
                                title=f"{channel.display_name} · directo {time.strftime('%H:%M', time.localtime(payload.get('peak_wall', time.time())))}",
                                storage_key=key, sha256=sha256_file(src), size_bytes=size, mime="video/mp4",
                                duration=info.duration, width=info.width, height=info.height, fps=info.fps,
                                has_audio=info.has_audio, has_video=info.has_video, probe=info.raw,
                                channel_id=channel.id, stream_session_id=session.id,
                                stream_offset=max(a, win_start), streamer_name=channel.display_name,
                                game=session.category)
            db.add(asset)
            db.flush()
            thumb = tmp / "thumb.jpg"
            ff.thumbnail(src, thumb, min(info.duration / 2, PRE))
            _store(db, asset, thumb, "thumbnail", "thumb.jpg", "image/jpeg")
            if not info.has_audio:
                db.commit()
                return
            wav = tmp / "audio.wav"
            ff.extract_audio(src, wav)
            _store(db, asset, wav, "audio", "audio.wav", "audio/wav", duration=info.duration)
            wf = tmp / "waveform.json"
            wf.write_text(json.dumps({"peaks_per_second": 20, "peaks": ff.waveform_peaks(wav)}))
            _store(db, asset, wf, "waveform", "waveform.json", "application/json")
            db.commit()

            # Análisis profundo de la ventana
            feats = audio_mod.compute_features(ff.read_pcm(wav))
            events = audio_mod.detect_events(feats, float(ap.get("sensitivity", 1.0)))
            segments: list[transcribe.Segment] = []
            if get_settings().transcription_enabled and transcribe.available():
                tr = transcribe.transcribe_file(wav, info.duration, model_name=get_settings().whisper_live_model)
                segments = tr.segments
                for s in tr.segments:
                    db.add(TranscriptSegment(source_asset_id=asset.id, start=s.start, end=s.end, text=s.text,
                                             language=tr.language, confidence=s.confidence,
                                             words=[{"start": round(w.start, 3), "end": round(w.end, 3),
                                                     "text": w.text, "prob": round(w.prob, 3)} for w in s.words]))
                db.commit()
            chat_msgs = [(float(t) - asset.stream_offset, txt) for t, txt in payload.get("chat", [])]
            chat_raw = chat_mod.series(chat_msgs, feats.n, feats.hop) if chat_msgs else None
            sig = Signals(hop=feats.hop, duration=info.duration, audio=feats, audio_events=events, segments=segments,
                          seg_scores=semantic.score_segments(segments),
                          chat=chat_mod.activity_score(chat_raw, feats.hop) if chat_raw else None, chat_raw=chat_raw)
            existing = []
            for c, off in db.execute(select(HighlightCandidate, SourceAsset.stream_offset)
                                     .join(SourceAsset, SourceAsset.id == HighlightCandidate.source_asset_id)
                                     .where(HighlightCandidate.stream_session_id == session.id,
                                            HighlightCandidate.status == "clipped")):
                rel = (off or 0) - asset.stream_offset
                existing.append(Candidate(c.start + rel, c.end + rel, c.peak_time + rel, c.score, dict(c.scores),
                                          c.category, c.confidence, c.explanation, [], c.transcript_text or ""))
            params = DetectionParams(duration_mode=str(ap.get("duration_mode", "auto")),
                                     sensitivity=float(ap.get("sensitivity", 1.0)), max_candidates=3,
                                     categories=ap.get("categories") or None, min_gap=10.0)
            accepted, dups = generate_candidates(sig, params, existing)
            peak_rel = peak - asset.stream_offset
            best = next((c for c in accepted if c.start <= peak_rel <= c.end), accepted[0] if accepted else None)
            min_score = float(ap.get("min_score", 55))
            if best is None or best.score < min_score:
                reason = "duplicado de un clip anterior" if dups and not accepted else \
                    f"puntuación {best.score:.0f} < {min_score:.0f}" if best else "sin momento claro"
                record_event(db, workspace_id=session.workspace_id, type="candidate_rejected",
                             label=f"Candidato descartado ({reason})", channel_id=channel.id,
                             stream_session_id=session.id, t_start=peak, value=best.score if best else None)
                db.commit()
                return
            cand = HighlightCandidate(workspace_id=session.workspace_id, source_asset_id=asset.id,
                                      stream_session_id=session.id, start=best.start, end=best.end,
                                      peak_time=best.peak, recommended_duration=round(best.duration, 2),
                                      score=best.score, scores=best.scores, category=best.category,
                                      confidence=best.confidence, explanation=best.explanation,
                                      transcript_text=best.text or None, status="pending")
            db.add(cand)
            db.flush()
            record_event(db, workspace_id=session.workspace_id, type="candidate",
                         label=f"Candidato enviado a edición ({best.score:.0f}/100): "
                               f"{semantic.CATEGORY_LABELS.get(best.category, best.category)}",
                         channel_id=channel.id, stream_session_id=session.id, t_start=peak, value=best.score,
                         confidence=best.confidence, data={"candidate_id": str(cand.id)})
            latency = time.time() - float(payload.get("peak_wall", t_start))
            clip_cfg = {"template_slug": ap.get("template_slug"), "format": ap.get("format"),
                        "subtitles": ap.get("subtitles", True), "auto_edit": ap.get("auto_edit", True),
                        "auto_render": ap.get("auto_save", True)}
            clip = create_clip_from_candidate(db, cand, asset, clip_cfg, origin="live", channel=channel,
                                              session=session, latency=round(latency, 1))
            clip.platform_data = {**(clip.platform_data or {}), "peak_wall": payload.get("peak_wall"),
                                  "trigger": payload.get("reason")}
            db.commit()


# ---------------------------------------------------------------------------
# PLATFORM_CLIPS (Twitch)
# ---------------------------------------------------------------------------

def create_platform_clip(session_id: uuid.UUID, reason: str, peak_wall: float, data: dict | None = None) -> Clip | None:
    tw = get_twitch()
    with SessionLocal() as db:
        session = db.get(StreamSession, session_id)
        channel = db.get(Channel, session.channel_id) if session else None
        if channel is None or channel.platform != "twitch" or not channel.platform_user_id:
            return None
        conn = user_connection(db, channel.workspace_id, "twitch")
        token = valid_user_token(db, conn) if conn else None
        if not token or "clips:edit" not in (conn.scopes or []):
            return None
        try:
            created = tw.create_clip(token, channel.platform_user_id)
        except TwitchError as exc:
            record_event(db, workspace_id=channel.workspace_id, type="platform_clip_error",
                         label=f"No se pudo crear el clip en Twitch: {exc}", channel_id=channel.id,
                         stream_session_id=session.id)
            db.commit()
            return None
        clip_id = created["id"]
        info = None
        for _ in range(15):  # Twitch tarda unos segundos en procesar el clip
            time.sleep(1.5)
            try:
                found = tw.get_clips(ids=[clip_id])
            except TwitchError:
                found = []
            if found:
                info = found[0]
                break
        clip = Clip(workspace_id=channel.workspace_id, origin="platform", channel_id=channel.id,
                    stream_session_id=session.id, title=(info or {}).get("title") or f"Clip de {channel.display_name}",
                    status="detected", category="chat", score=None, format="16:9",
                    streamer_name=channel.display_name, platform="twitch", game=session.category,
                    stream_time=utcnow(), detection_latency_s=round(time.time() - peak_wall, 1),
                    platform_clip_id=clip_id,
                    platform_clip_url=(info or {}).get("url") or f"https://clips.twitch.tv/{clip_id}",
                    platform_thumbnail_url=(info or {}).get("thumbnail_url"),
                    platform_data={"edit_url": created.get("edit_url"), "trigger": reason, **(data or {}),
                                   "duration": (info or {}).get("duration")})
        db.add(clip)
        db.flush()
        record_event(db, workspace_id=channel.workspace_id, type="platform_clip",
                     label="Clip oficial creado en Twitch", channel_id=channel.id, stream_session_id=session.id,
                     data={"clip_id": str(clip.id), "url": clip.platform_clip_url})
        db.commit()
        publish(channel.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title,
                                               "channel_id": str(channel.id)})
        # Descarga solo mediante el endpoint oficial y si los permisos lo permiten
        if info and set(conn.scopes or []) & DOWNLOAD_SCOPES:
            try:
                dl = tw.get_clip_download_urls(token, conn.external_user_id or "", channel.platform_user_id, [clip_id])
                url = (dl[0] if dl else {}).get("landscape_download_url")
                if url:
                    _download_platform_clip(db, clip, url)
            except (TwitchError, UnsafeURL, httpx.HTTPError) as exc:
                write_log(channel.workspace_id, "live", session.id, "warning",
                          f"Clip guardado como referencia (descarga no permitida): {exc}")
        return clip


def _download_platform_clip(db, clip: Clip, url: str) -> None:
    validate_public_http_url(url)
    storage = get_storage()
    asset_id = uuid.uuid4()
    with temp_dir("platform-clip") as tmp:
        dest = tmp / "clip.mp4"
        with httpx.stream("GET", url, timeout=60, follow_redirects=False) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        key = f"ws/{clip.workspace_id}/originals/{asset_id}/twitch-{clip.platform_clip_id}.mp4"
        size = storage.put_file(Path(dest), key, "video/mp4")
        asset = SourceAsset(id=asset_id, workspace_id=clip.workspace_id, kind="platform_clip", status="uploaded",
                            title=clip.title, storage_key=key, sha256=sha256_file(dest), size_bytes=size,
                            mime="video/mp4", channel_id=clip.channel_id, stream_session_id=clip.stream_session_id,
                            streamer_name=clip.streamer_name)
        db.add(asset)
        db.flush()
        clip.source_asset_id = asset.id
        job = IngestionJob(workspace_id=clip.workspace_id, source_asset_id=asset.id, auto_analyze=False)
        db.add(job)
        db.commit()
        from app.workers.dispatch import enqueue_ingestion
        enqueue_ingestion(job.id)
