"""Orquestación del procesamiento: ingesta → análisis → candidatos → clips → render.

Cada función recibe el id de un trabajo persistido y es idempotente: si el worker cae, el
trabajo se puede reintentar sin duplicar resultados.
"""

from __future__ import annotations

import io
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.analysis import audio as audio_mod
from app.analysis import chat as chat_mod
from app.analysis import semantic, transcribe
from app.analysis import visual as visual_mod
from app.analysis.scoring import Candidate, DetectionParams, Signals, generate_candidates
from app.core.config import get_settings
from app.db.models import (
    AnalysisJob,
    Channel,
    Clip,
    ClipVersion,
    Export,
    HighlightCandidate,
    IngestionJob,
    MediaAsset,
    SourceAsset,
    TranscriptSegment,
    utcnow,
)
from app.db.session import SessionLocal
from app.media import ffmpeg as ff
from app.media.editspec import EditSpec
from app.media.render import render
from app.storage import get_storage, sha256_file, temp_dir

from .bus import publish
from .jobs import JobContext, record_event
from .settings import get_settings_data
from .templates import build_spec, get_template

log = logging.getLogger(__name__)


def derived_key(asset: SourceAsset, name: str) -> str:
    return f"ws/{asset.workspace_id}/derived/{asset.id}/{name}"


def _store(db: Session, asset: SourceAsset, local: Path, kind: str, name: str, mime: str, **meta: Any) -> MediaAsset:
    storage = get_storage()
    key = derived_key(asset, name)
    size = storage.put_file(local, key, mime)
    old = db.scalars(select(MediaAsset).where(MediaAsset.source_asset_id == asset.id, MediaAsset.kind == kind))
    for o in old:
        if o.storage_key != key:
            storage.delete(o.storage_key)
        db.delete(o)
    m = MediaAsset(workspace_id=asset.workspace_id, source_asset_id=asset.id, kind=kind, storage_key=key, mime=mime,
                   size_bytes=size, duration=meta.pop("duration", None), width=meta.pop("width", None),
                   height=meta.pop("height", None), meta=meta)
    db.add(m)
    db.flush()
    return m


def media_of(db: Session, asset_id: uuid.UUID, kind: str) -> MediaAsset | None:
    return db.scalar(select(MediaAsset).where(MediaAsset.source_asset_id == asset_id, MediaAsset.kind == kind)
                     .order_by(MediaAsset.created_at.desc()))


# ---------------------------------------------------------------------------
# Ingesta
# ---------------------------------------------------------------------------

def run_ingestion(job_id: uuid.UUID) -> None:
    ctx = JobContext("ingestion", job_id)
    if not ctx.start():
        return
    storage = get_storage()
    try:
        with SessionLocal() as db:
            job = db.get(IngestionJob, job_id)
            asset = db.get(SourceAsset, job.source_asset_id)
            asset.status = "processing"
            db.commit()
            publish(asset.workspace_id, "asset", asset_brief(asset))
            with storage.as_local(asset.storage_key) as src, temp_dir("ingest") as tmp:
                ctx.progress(0.02, "Validando archivo", force=True)
                info = ff.validate_video(src, asset.original_filename)
                asset.duration, asset.width, asset.height, asset.fps = info.duration, info.width, info.height, info.fps
                asset.has_audio, asset.has_video, asset.probe = info.has_audio, info.has_video, info.raw
                db.commit()

                ctx.progress(0.08, "Generando miniatura", force=True)
                thumb = tmp / "thumb.jpg"
                ff.thumbnail(src, thumb, min(info.duration * 0.1, 30.0))
                _store(db, asset, thumb, "thumbnail", "thumb.jpg", "image/jpeg")
                db.commit()

                if info.has_audio:
                    ctx.progress(0.12, "Extrayendo audio", force=True)
                    wav = tmp / "audio.wav"
                    ff.extract_audio(src, wav, cancel=ctx.cancelled, duration=info.duration,
                                     progress=lambda p: ctx.progress(0.12 + 0.18 * p, "Extrayendo audio"))
                    _store(db, asset, wav, "audio", "audio.wav", "audio/wav", duration=info.duration)
                    peaks = ff.waveform_peaks(wav)
                    wf = tmp / "waveform.json"
                    wf.write_text(json.dumps({"peaks_per_second": 20, "peaks": peaks}))
                    _store(db, asset, wf, "waveform", "waveform.json", "application/json")
                    db.commit()

                ctx.progress(0.32, "Creando proxy de edición", force=True)
                proxy = tmp / "proxy.mp4"
                ff.make_proxy(src, proxy, get_settings().proxy_height, info.duration, cancel=ctx.cancelled,
                              progress=lambda p: ctx.progress(0.32 + 0.66 * p, "Creando proxy de edición"))
                pinfo = ff.probe(proxy)
                _store(db, asset, proxy, "proxy", "proxy.mp4", "video/mp4", duration=pinfo.duration,
                       width=pinfo.width, height=pinfo.height)
                asset.status = "ready"
                db.commit()
                publish(asset.workspace_id, "asset", asset_brief(asset))
                auto = job.auto_analyze
                mode = (job.params or {}).get("mode", "highlights")
                ws = asset.workspace_id
                aid = asset.id
        ctx.finish("succeeded")
        ctx.log("info", "Ingesta completada", asset_id=str(aid))
        if mode == "edit":
            from app.workers.dispatch import enqueue_analysis
            with SessionLocal() as db:
                a = db.get(SourceAsset, aid)
                clip = Clip(workspace_id=ws, origin="manual", source_asset_id=aid, title=a.title, status="processing",
                            start=0.0, end=a.duration, streamer_name=a.streamer_name, game=a.game,
                            channel_id=a.channel_id)
                db.add(clip)
                db.flush()
                aj = AnalysisJob(workspace_id=ws, source_asset_id=aid, kind="ai_edit",
                                 params={"clip_id": str(clip.id), "options": (job.params or {}).get("options") or {}})
                db.add(aj)
                db.commit()
                enqueue_analysis(aj.id)
        elif auto:
            from app.workers.dispatch import enqueue_analysis
            with SessionLocal() as db:
                params: dict[str, Any] = {}
                src = db.get(SourceAsset, aid)
                if src is not None and src.kind == "platform_clip":
                    owner = db.scalar(select(Clip.id).where(Clip.source_asset_id == aid))
                    params = {"no_clips": True, "platform_clip": str(owner) if owner else None}
                aj = AnalysisJob(workspace_id=ws, source_asset_id=aid, kind="full", params=params)
                db.add(aj)
                db.commit()
                enqueue_analysis(aj.id)
    except ff.Cancelled:
        _fail_asset(job_id, "cancelled")
        ctx.finish("cancelled")
    except Exception as exc:
        log.exception("Ingesta fallida")
        ctx.log("error", f"Ingesta fallida: {exc}")
        retry = isinstance(exc, (OSError,)) and ctx.should_retry()
        _fail_asset(job_id, "failed" if not retry else None)
        ctx.finish("failed" if not retry else "queued", str(exc))
        if retry:
            from app.workers.dispatch import enqueue_ingestion
            enqueue_ingestion(job_id, delay_ms=5000)


def _fail_asset(job_id: uuid.UUID, status: str | None) -> None:
    if status is None:
        return
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        asset = db.get(SourceAsset, job.source_asset_id) if job else None
        if asset:
            asset.status = "failed" if status == "failed" else "uploaded"
            db.commit()
            publish(asset.workspace_id, "asset", asset_brief(asset))


def asset_brief(a: SourceAsset) -> dict[str, Any]:
    return {"id": str(a.id), "title": a.title, "status": a.status, "kind": a.kind, "duration": a.duration}


# ---------------------------------------------------------------------------
# Análisis
# ---------------------------------------------------------------------------

def _params(detection: dict[str, Any], overrides: dict[str, Any]) -> DetectionParams:
    d = {**detection, **{k: v for k, v in overrides.items() if v is not None}}
    return DetectionParams(
        duration_mode=str(d.get("duration_mode", "auto")), custom_duration=d.get("custom_duration"),
        sensitivity=float(d.get("sensitivity", 1.0)), max_candidates=int(d.get("max_candidates", 12)),
        min_score=float(d.get("min_score", 0.0)), categories=d.get("categories") or None,
        weights=d.get("weights") or {})


def _load_npz(key: str) -> dict | None:
    storage = get_storage()
    if not storage.exists(key):
        return None
    with storage.as_local(key) as p:
        with np.load(p, allow_pickle=False) as z:
            return {k: z[k] for k in z.files}


def _save_npz(db: Session, asset: SourceAsset, name: str, tmp: Path, **arrays: np.ndarray) -> None:
    p = tmp / name
    np.savez_compressed(p, **arrays)
    get_storage().put_file(p, derived_key(asset, name), "application/octet-stream")


def audio_features_for(db: Session, asset: SourceAsset, wav: Path, tmp: Path, reuse: bool = True):
    key = derived_key(asset, "audio_features.npz")
    cached = _load_npz(key) if reuse else None
    if cached is not None and "rms_db" in cached:
        f = audio_mod.AudioFeatures(hop=float(cached["hop"]), rms_db=cached["rms_db"], centroid=cached["centroid"],
                                    flatness=cached["flatness"], zcr=cached["zcr"], onset=cached["onset"],
                                    laugh_mod=cached["laugh_mod"], clip_ratio=float(cached["clip_ratio"]),
                                    noise_floor_db=float(cached["noise_floor_db"]), z_energy=cached["z_energy"],
                                    z_centroid=cached["z_centroid"])
        return f, True
    f = audio_mod.compute_features(ff.read_pcm(wav))
    _save_npz(db, asset, "audio_features.npz", tmp, hop=np.float32(f.hop), rms_db=f.rms_db, centroid=f.centroid,
              flatness=f.flatness, zcr=f.zcr, onset=f.onset, laugh_mod=f.laugh_mod,
              clip_ratio=np.float32(f.clip_ratio), noise_floor_db=np.float32(f.noise_floor_db),
              z_energy=f.z_energy, z_centroid=f.z_centroid)
    return f, False


def segments_from_db(db: Session, asset_id: uuid.UUID) -> list[transcribe.Segment]:
    rows = db.scalars(select(TranscriptSegment).where(TranscriptSegment.source_asset_id == asset_id)
                      .order_by(TranscriptSegment.start))
    return [transcribe.Segment(r.start, r.end, r.text, r.confidence or 0.5,
                               [transcribe.Word(w["start"], w["end"], w["text"], w.get("prob", 1.0)) for w in r.words])
            for r in rows]


def words_in(db: Session, asset_id: uuid.UUID, start: float, end: float) -> list[dict]:
    rows = db.scalars(select(TranscriptSegment).where(TranscriptSegment.source_asset_id == asset_id,
                                                      TranscriptSegment.end > start,
                                                      TranscriptSegment.start < end)
                      .order_by(TranscriptSegment.start))
    return [w for r in rows for w in r.words if w["end"] > start and w["start"] < end]


def run_analysis(job_id: uuid.UUID) -> None:
    with SessionLocal() as db:
        j = db.get(AnalysisJob, job_id)
        kind = j.kind if j else None
    if kind == "ai_edit":
        from .ai_editor import run_ai_edit
        return run_ai_edit(job_id)
    ctx = JobContext("analysis", job_id)
    if not ctx.start():
        return
    storage = get_storage()
    t0 = time.monotonic()
    try:
        with SessionLocal() as db:
            job = db.get(AnalysisJob, job_id)
            asset = db.get(SourceAsset, job.source_asset_id)
            if asset is None or asset.status != "ready":
                raise RuntimeError("El vídeo no está listo para analizar")
            cfg = get_settings_data(db, asset.workspace_id)
            det = cfg["detection"]
            params = _params(det, job.params or {})
            result: dict[str, Any] = {"modalities": {}}
            audio_m = media_of(db, asset.id, "audio")
            proxy_m = media_of(db, asset.id, "proxy")
            duration = asset.duration or 0.0
            with temp_dir("analysis") as tmp:
                # 1) Audio
                ctx.progress(0.02, "Analizando audio", force=True)
                if audio_m is None:
                    result["modalities"]["audio"] = "sin pista de audio"
                    n = max(1, int(duration / audio_mod.HOP))
                    z = np.zeros(n, dtype=np.float32)
                    feats = audio_mod.AudioFeatures(audio_mod.HOP, z - 60, z, z, z, z, z, z_energy=z, z_centroid=z)
                    events: list[audio_mod.AudioEvent] = []
                    wav_ctx = None
                else:
                    wav_ctx = storage.as_local(audio_m.storage_key)
                    wav = wav_ctx.__enter__()
                    feats, cached = audio_features_for(db, asset, wav, tmp, reuse=not job.params.get("force"))
                    events = audio_mod.detect_events(feats, params.sensitivity)
                    result["modalities"]["audio"] = "reutilizado" if cached else "ok"
                try:
                    db.execute(delete(HighlightCandidate).where(HighlightCandidate.source_asset_id == asset.id,
                                                                HighlightCandidate.status.in_(("pending", "duplicate",
                                                                                               "rejected"))))
                    from app.db.models import DetectedEvent
                    db.execute(delete(DetectedEvent).where(DetectedEvent.source_asset_id == asset.id))
                    for ev in events:
                        if ev.type == "silence":
                            continue
                        record_event(db, workspace_id=asset.workspace_id, type=ev.type, label=ev.label,
                                     source_asset_id=asset.id, channel_id=asset.channel_id, t_start=ev.start,
                                     t_end=ev.end, confidence=ev.confidence, value=ev.value, notify=False)
                    db.commit()
                    if ctx.cancelled():
                        raise ff.Cancelled()

                    # 2) Transcripción
                    segments: list[transcribe.Segment] = []
                    language = None
                    if audio_m is not None and det.get("transcription", True) and get_settings().transcription_enabled \
                            and transcribe.available():
                        existing = segments_from_db(db, asset.id)
                        if existing and not job.params.get("force"):
                            segments = existing
                            result["modalities"]["transcription"] = "reutilizada"
                        else:
                            ctx.progress(0.1, "Transcribiendo voz", force=True)
                            tr = transcribe.transcribe_file(
                                wav, duration, model_name=det.get("whisper_model") or None, cancel=ctx.cancelled,
                                progress=lambda p: ctx.progress(0.1 + 0.55 * p, "Transcribiendo voz"))
                            db.execute(delete(TranscriptSegment).where(TranscriptSegment.source_asset_id == asset.id))
                            for s in tr.segments:
                                db.add(TranscriptSegment(
                                    source_asset_id=asset.id, start=s.start, end=s.end, text=s.text,
                                    language=tr.language, confidence=s.confidence,
                                    words=[{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.text,
                                            "prob": round(w.prob, 3)} for w in s.words]))
                            db.commit()
                            segments = tr.segments
                            language = tr.language
                            result["modalities"]["transcription"] = f"ok ({tr.language})"
                    else:
                        result["modalities"]["transcription"] = "desactivada o no disponible"
                    result["language"] = language or db.scalar(
                        select(TranscriptSegment.language).where(TranscriptSegment.source_asset_id == asset.id).limit(1))
                    seg_scores = semantic.score_segments(segments)

                    # 3) Visual
                    vis_series = None
                    scene_cuts: list[float] = []
                    webcam = None
                    faces: list = []
                    if det.get("visual_analysis", True) and proxy_m is not None:
                        ctx.progress(0.68, "Analizando imagen", force=True)
                        with storage.as_local(proxy_m.storage_key) as proxy:
                            vf = visual_mod.analyze(proxy, duration, asset.width, asset.height, feats.hop,
                                                    cancel=ctx.cancelled)
                        vis_series = visual_mod.visual_series(vf, feats.n)
                        scene_cuts, webcam, faces = vf.scene_cuts, vf.webcam_region, vf.faces
                        for t in scene_cuts[:200]:
                            record_event(db, workspace_id=asset.workspace_id, type="scene_change",
                                         label="Cambio de escena", source_asset_id=asset.id, t_start=t, t_end=t,
                                         confidence=0.8, notify=False)
                        db.commit()  # no retener el bloqueo de escritura (SQLite) durante el resto del análisis
                        result["modalities"]["visual"] = "ok"
                        result["webcam_region"] = webcam
                        result["faces"] = faces[:400]
                        result["face_ratio"] = round(vf.face_ratio, 3)
                    else:
                        result["modalities"]["visual"] = "desactivado"

                    # 4) Chat (si se importó un registro autorizado)
                    chat_curve = chat_raw = None
                    if asset.chat_log:
                        msgs = [(float(t), str(txt)) for t, txt in asset.chat_log]
                        chat_raw = chat_mod.series(msgs, feats.n, feats.hop)
                        chat_curve = chat_mod.activity_score(chat_raw, feats.hop)
                        result["modalities"]["chat"] = f"ok ({len(msgs)} mensajes)"
                    else:
                        result["modalities"]["chat"] = "sin registro de chat"

                    # 5) Candidatos
                    db.commit()
                    ctx.progress(0.9, "Generando y puntuando candidatos", force=True)
                    kept = list(db.scalars(select(HighlightCandidate).where(
                        HighlightCandidate.source_asset_id == asset.id,
                        HighlightCandidate.status.in_(("accepted", "clipped")))))
                    existing_c = [Candidate(c.start, c.end, c.peak_time, c.score, dict(c.scores), c.category,
                                            c.confidence, c.explanation, [], c.transcript_text or "") for c in kept]
                    sig = Signals(hop=feats.hop, duration=duration, audio=feats, audio_events=events,
                                  segments=segments, seg_scores=seg_scores, visual=vis_series, scene_cuts=scene_cuts,
                                  chat=chat_curve, chat_raw=chat_raw)
                    accepted, dups = generate_candidates(sig, params, existing_c)
                finally:
                    if wav_ctx is not None:
                        wav_ctx.__exit__(None, None, None)
                rows: list[HighlightCandidate] = []
                for c in accepted:
                    row = HighlightCandidate(
                        workspace_id=asset.workspace_id, source_asset_id=asset.id, analysis_job_id=job.id,
                        start=c.start, end=c.end, peak_time=c.peak, recommended_duration=round(c.duration, 2),
                        score=c.score, scores=c.scores, category=c.category, confidence=c.confidence,
                        explanation=c.explanation, transcript_text=c.text or None, status="pending")
                    db.add(row)
                    rows.append(row)
                for c in dups:
                    db.add(HighlightCandidate(
                        workspace_id=asset.workspace_id, source_asset_id=asset.id, analysis_job_id=job.id,
                        start=c.start, end=c.end, peak_time=c.peak, recommended_duration=round(c.duration, 2),
                        score=c.score, scores=c.scores, category=c.category, confidence=c.confidence,
                        explanation=c.explanation, transcript_text=c.text or None, status="duplicate"))
                db.flush()
                for row in rows:
                    record_event(db, workspace_id=asset.workspace_id, type="candidate",
                                 label=f"Candidato ({row.score:.0f}/100): {semantic.CATEGORY_LABELS.get(row.category, row.category)}",
                                 source_asset_id=asset.id, t_start=row.start, t_end=row.end,
                                 confidence=row.confidence, value=row.score,
                                 data={"candidate_id": str(row.id)}, notify=False)
                result.update(candidates=len(rows), duplicates=len(dups), events=len(events),
                              processing_seconds=round(time.monotonic() - t0, 2),
                              realtime_factor=round(duration / max(0.01, time.monotonic() - t0), 2))
                db.commit()
                publish(asset.workspace_id, "candidates", {"source_asset_id": str(asset.id), "count": len(rows)})

                clip_cfg = cfg["clipping"]
                created = 0
                if clip_cfg.get("auto_create_clips", True) and not job.params.get("no_clips"):
                    limit = int(job.params.get("max_clips") or clip_cfg.get("max_clips_per_source", 8))
                    for row in sorted(rows, key=lambda r: r.score, reverse=True)[:limit]:
                        if row.score < params.min_score:
                            continue
                        create_clip_from_candidate(db, row, asset, clip_cfg, webcam=webcam, faces=faces)
                        created += 1
                result["clips_created"] = created
                if job.params.get("platform_clip"):
                    pclip = db.get(Clip, uuid.UUID(job.params["platform_clip"]))
                    if pclip is not None and not pclip.versions:
                        edit_whole_asset_clip(db, pclip, asset, clip_cfg, webcam=webcam, faces=faces,
                                              best=rows[0] if rows else None)
        ctx.finish("succeeded", result=result)
        ctx.log("info", f"Análisis completado: {result.get('candidates', 0)} candidatos, {created} clips",
                **{k: v for k, v in result.items() if k not in ("faces",)})
    except ff.Cancelled:
        ctx.finish("cancelled")
    except Exception as exc:
        log.exception("Análisis fallido")
        ctx.log("error", f"Análisis fallido: {exc}")
        ctx.finish("failed", str(exc))


# ---------------------------------------------------------------------------
# Clips
# ---------------------------------------------------------------------------

def create_clip_from_candidate(db: Session, cand: HighlightCandidate, asset: SourceAsset, clip_cfg: dict[str, Any], *,
                               webcam: dict | None = None, faces: list | None = None, origin: str = "analysis",
                               channel=None, session=None, latency: float | None = None,
                               render_now: bool | None = None) -> Clip:
    tpl = get_template(db, asset.workspace_id, slug=clip_cfg.get("template_slug") or "gaming-viral")
    if channel is not None and channel.default_template_id:
        tpl = get_template(db, asset.workspace_id, template_id=channel.default_template_id) or tpl
    words = words_in(db, asset.id, cand.start, cand.end)
    spec = build_spec(tpl.spec if tpl else {}, source_asset_id=str(asset.id), start=cand.start, end=cand.end,
                      words=words, peak=cand.peak_time, source_w=asset.width, source_h=asset.height, webcam=webcam,
                      faces=faces, auto_edit=bool(clip_cfg.get("auto_edit", True)),
                      format_override=clip_cfg.get("format"), subtitles_override=clip_cfg.get("subtitles"))
    title = semantic.generate_title(cand.transcript_text or "", cand.category)
    stream_time = None
    if session is not None and asset.stream_offset is not None:
        from datetime import timedelta
        stream_time = session.started_at + timedelta(seconds=asset.stream_offset + cand.start)
    clip = Clip(workspace_id=asset.workspace_id, origin=origin, candidate_id=cand.id, source_asset_id=asset.id,
                channel_id=asset.channel_id, stream_session_id=asset.stream_session_id, title=title,
                status="processing", score=cand.score, category=cand.category, start=cand.start, end=cand.end,
                format=spec.format, transcript_text=cand.transcript_text, streamer_name=asset.streamer_name,
                platform=channel.platform if channel is not None else None, game=asset.game,
                stream_time=stream_time, detection_latency_s=latency)
    db.add(clip)
    db.flush()
    version = ClipVersion(clip_id=clip.id, version_no=1, edit_spec=spec.model_dump(mode="json"),
                          status="draft", note="Edición automática" if spec.auto_edit else "Corte directo")
    db.add(version)
    db.flush()
    clip.current_version_id = version.id
    cand.status = "clipped"
    should_render = clip_cfg.get("auto_render", True) if render_now is None else render_now
    if not should_render:
        clip.status = "detected"
    db.commit()
    publish(asset.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title,
                                          "score": clip.score, "channel_id": str(clip.channel_id) if clip.channel_id else None})
    if should_render:
        queue_render(db, clip, version)
    return clip


def edit_whole_asset_clip(db: Session, clip: Clip, asset: SourceAsset, clip_cfg: dict[str, Any], *,
                          webcam: dict | None = None, faces: list | None = None,
                          best: HighlightCandidate | None = None) -> Clip:
    """Edición automática de un clip que ya es el vídeo completo (p. ej. clip oficial de Twitch descargado):
    vertical con la plantilla del canal, subtítulos por palabra, y render listo para publicar."""
    tpl = get_template(db, asset.workspace_id, slug=clip_cfg.get("template_slug") or "gaming-viral")
    channel = db.get(Channel, clip.channel_id) if clip.channel_id else None
    if channel is not None and channel.default_template_id:
        tpl = get_template(db, asset.workspace_id, template_id=channel.default_template_id) or tpl
    end = float(asset.duration or 0)
    spec = build_spec(tpl.spec if tpl else {}, source_asset_id=str(asset.id), start=0.0, end=end,
                      words=words_in(db, asset.id, 0.0, end), peak=best.peak_time if best else end / 2,
                      source_w=asset.width, source_h=asset.height, webcam=webcam, faces=faces,
                      auto_edit=bool(clip_cfg.get("auto_edit", True)), format_override=clip_cfg.get("format"),
                      subtitles_override=clip_cfg.get("subtitles"))
    clip.start, clip.end, clip.format = 0.0, end, spec.format
    if best is not None:
        clip.score = clip.score or best.score
        clip.transcript_text = clip.transcript_text or best.transcript_text
    version = ClipVersion(clip_id=clip.id, version_no=1, edit_spec=spec.model_dump(mode="json"), status="draft",
                          note="Edición automática del clip de Twitch")
    db.add(version)
    db.flush()
    clip.current_version_id = version.id
    db.commit()
    queue_render(db, clip, version)
    return clip


def queue_render(db: Session, clip: Clip, version: ClipVersion, priority: int = 5) -> Export:
    from app.workers.dispatch import enqueue_export
    exp = Export(workspace_id=clip.workspace_id, clip_id=clip.id, clip_version_id=version.id, priority=priority)
    version.status = "rendering"
    if clip.status not in ("approved", "published"):
        clip.status = "processing"
    db.add(exp)
    db.commit()
    enqueue_export(exp.id)
    return exp


def run_export(export_id: uuid.UUID) -> None:
    ctx = JobContext("export", export_id)
    if not ctx.start():
        return
    storage = get_storage()
    t0 = time.monotonic()
    try:
        with SessionLocal() as db:
            exp = db.get(Export, export_id)
            version = db.get(ClipVersion, exp.clip_version_id)
            clip = db.get(Clip, exp.clip_id)
            spec = EditSpec.model_validate(version.edit_spec)
            asset = db.get(SourceAsset, uuid.UUID(spec.source_asset_id))
            if asset is None or asset.workspace_id != clip.workspace_id or not asset.storage_key:
                raise RuntimeError("El vídeo original del clip ya no existe")
            with storage.as_local(asset.storage_key) as src, temp_dir("render") as tmp:
                out = tmp / "clip.mp4"
                ctx.progress(0.01, "Renderizando", force=True)
                res = render(spec, src, out, tmp, cancel=ctx.cancelled,
                             progress=lambda p: ctx.progress(0.02 + 0.93 * p, "Renderizando"))
                thumb = tmp / "thumb.jpg"
                ff.thumbnail(out, thumb, min(res.duration * 0.35, max(0.0, res.duration - 0.5)), width=540)
                base = f"ws/{clip.workspace_id}/renders/{clip.id}/v{version.version_no}-{export_id.hex[:8]}"
                size = storage.put_file(out, base + ".mp4", "video/mp4")
                tsize = storage.put_file(thumb, base + ".jpg", "image/jpeg")
                media = MediaAsset(workspace_id=clip.workspace_id, clip_version_id=version.id, kind="render",
                                   storage_key=base + ".mp4", mime="video/mp4", size_bytes=size, sha256=sha256_file(out),
                                   duration=res.duration, width=res.width, height=res.height,
                                   meta={"av_sync_diff": res.av_sync_diff})
                tmedia = MediaAsset(workspace_id=clip.workspace_id, clip_version_id=version.id, kind="clip_thumbnail",
                                    storage_key=base + ".jpg", mime="image/jpeg", size_bytes=tsize)
                db.add_all([media, tmedia])
                db.flush()
                version.render_asset_id = media.id
                version.thumbnail_asset_id = tmedia.id
                version.status = "ready"
                exp.media_asset_id = media.id
                exp.duration_s = round(time.monotonic() - t0, 2)
                if clip.status in ("processing", "detected", "editing"):
                    clip.status = "pending"
                peak_wall = (clip.platform_data or {}).get("peak_wall")
                if peak_wall and "ready_latency_s" not in (clip.platform_data or {}):
                    # Latencia real: desde que ocurrió el momento en el directo hasta tener el MP4 listo
                    clip.platform_data = {**clip.platform_data, "ready_latency_s": round(time.time() - peak_wall, 1)}
                db.commit()
                publish(clip.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title,
                                                    "rendered": True, "score": clip.score,
                                                    "channel_id": str(clip.channel_id) if clip.channel_id else None})
        ctx.finish("succeeded")
    except ff.Cancelled:
        _version_failed(export_id, "draft")
        ctx.finish("cancelled")
    except Exception as exc:
        log.exception("Render fallido")
        ctx.log("error", f"Render fallido: {exc}")
        if ctx.should_retry() and isinstance(exc, OSError):
            ctx.finish("queued", str(exc))
            from app.workers.dispatch import enqueue_export
            enqueue_export(export_id, delay_ms=5000)
            return
        _version_failed(export_id, "failed")
        ctx.finish("failed", str(exc))


def _version_failed(export_id: uuid.UUID, status: str) -> None:
    with SessionLocal() as db:
        exp = db.get(Export, export_id)
        if not exp:
            return
        version = db.get(ClipVersion, exp.clip_version_id)
        clip = db.get(Clip, exp.clip_id)
        if version:
            version.status = status
        if clip and clip.status == "processing":
            clip.status = "detected"
        db.commit()
        if clip:
            publish(clip.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title})


def import_chat_log(raw: bytes) -> list[list[Any]]:
    """Acepta JSON [[t, texto], …], JSON [{"t"|"time"|"content_offset_seconds", "text"|"message"}] o JSONL."""
    text = raw.decode("utf-8", errors="replace").strip()
    items: list[Any]
    try:
        data = json.loads(text)
        items = data.get("comments") or data.get("messages") or [] if isinstance(data, dict) else data
    except json.JSONDecodeError:
        items = [json.loads(line) for line in io.StringIO(text) if line.strip()]
    out: list[list[Any]] = []
    for it in items:
        if isinstance(it, list) and len(it) >= 2:
            out.append([float(it[0]), str(it[1])[:500]])
        elif isinstance(it, dict):
            t = it.get("t", it.get("time", it.get("content_offset_seconds")))
            msg = it.get("text") or it.get("message")
            if isinstance(msg, dict):
                msg = msg.get("body")
            if t is not None and msg:
                out.append([float(t), str(msg)[:500]])
    out.sort(key=lambda x: x[0])
    return out[:2_000_000]
