"""Video analysis pipeline (runs in the worker).

 1. Locate & re-validate the uploaded file (ffprobe).
 2. Create a browser-playable proxy if needed (same timeline).
 3. Compute local signals (visual activity, loudness, black frames).
 4. Segment the video and plan frames (baseline + event peaks, bounded budget).
 5. Extract the frames at exact timestamps.
 6. Optional speech transcription for communication analysis.
 7. Segment-by-segment vision observation (structured JSON, frame-cited).
 8. Build the verified timeline and phases.
 9. Specialised analyzer modules -> findings (evidence-validated).
10. Transparent scores + coach report.
"""
from __future__ import annotations

import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from sqlalchemy import select

from ..config import get_settings
from ..db import session_scope
from ..jobs import JobCtx, PipelineError
from ..models import Analysis, Frame, Match, MediaFile
from ..storage import get_storage, materialize
from ..video import ffmpeg as ff
from ..video import transcribe as stt
from ..video.sampling import intensity_curve, plan_frames
from ..vision.provider import Part, ProviderError, get_provider
from . import engine, prompts
from .engine import AnalysisContext, Evidence, fmt_t
from .persist import save_analysis
from .schemas import SEGMENT_SCHEMA

CONTENT_GAMEPLAY = {"gameplay", "mixed"}


def _phase_fn(frame_items: list[dict]):
    readings = [(f["t"], f["hud"]["players_remaining"]) for f in frame_items if f.get("hud", {}).get("players_remaining")]
    gameplay = [f["t"] for f in frame_items if f.get("gameplay")]
    if len(readings) >= 3:
        start = max(r for _, r in readings)
        pts = sorted(readings)

        def phase(t: float) -> str:
            prior = [r for tt, r in pts if tt <= t] or [pts[0][1]]
            frac = prior[-1] / start if start else 1
            return "early" if frac > 0.6 else "mid" if frac > 0.25 else "end"

        return phase, "hud_players_remaining"
    if gameplay:
        a, b = min(gameplay), max(gameplay)
        span = max(1.0, b - a)

        def phase(t: float) -> str:
            x = (t - a) / span
            return "early" if x < 1 / 3 else "mid" if x < 2 / 3 else "end"

        return phase, "time_thirds_estimated"
    return (lambda t: "early"), "none"


def run_video_analysis(ctx: JobCtx, match_id: str, owner_id: str) -> str:
    s = get_settings()
    st = get_storage()
    provider = get_provider()
    ok, why = provider.configured()
    if not ok:
        raise PipelineError(f"El análisis con IA no está configurado: {why}", "ai_not_configured")

    with session_scope() as db:
        match = db.get(Match, match_id)
        video = db.scalar(select(MediaFile).where(MediaFile.match_id == match_id, MediaFile.kind == "video"))
        if not match or not video:
            raise PipelineError("La partida no tiene vídeo subido.", "no_video")
        player_label = match.player.name + (f" (Epic: {match.player.epic_id})" if match.player.epic_id else "")
        context = f"Partida '{match.title}'. Modo: {match.game_mode or match.player.game_mode or 'desconocido'}. Nivel: {match.player.competitive_level or 'desconocido'}. Plataforma: {match.player.platform or '?'}."
        if match.notes:
            context += f" Notas del coach: {match.notes[:500]}"
        video_key, video_id = video.storage_key, video.id
        has_proxy = db.scalar(select(MediaFile.id).where(MediaFile.match_id == match_id, MediaFile.kind == "proxy")) is not None
        analysis = Analysis(owner_id=owner_id, match_id=match_id, job_id=ctx.job_id, source_type="video", is_current=False,
                            model=provider.model, pipeline_version=engine.PIPELINE_VERSION)
        db.add(analysis)
        db.flush()
        analysis_id = analysis.id

    work = s.tmp_dir / f"job-{ctx.job_id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        # 1. validate
        ctx.progress("Validando vídeo", 1, "Comprobando el archivo con ffprobe", force=True)
        src = materialize(video_key, work, "source")
        info = ff.probe(src)
        if info.duration > s.max_video_seconds:
            raise PipelineError(f"El vídeo dura {fmt_t(info.duration)}; el máximo configurado es {s.max_video_seconds // 60} min.", "too_long")

        # 2. proxy for playback
        if not info.browser_playable and not has_proxy:
            ctx.progress("Preparando reproducción", 3, "Convirtiendo a MP4 H.264 para el reproductor", force=True)
            proxy_path = work / "proxy.mp4"
            ff.make_proxy(src, proxy_path, on_progress=lambda x: ctx.progress("Preparando reproducción", 3 + 12 * x), duration=info.duration)
            key = f"{owner_id}/{match_id}/proxy-{uuid.uuid4().hex[:8]}.mp4"
            size = proxy_path.stat().st_size
            st.put_file(proxy_path, key, "video/mp4")
            with session_scope() as db:
                db.add(MediaFile(owner_id=owner_id, match_id=match_id, kind="proxy", storage_key=key, original_name="proxy.mp4",
                                 size_bytes=size, sha256=f"proxy-{video_id}", mime="video/mp4", duration_s=info.duration,
                                 width=None, height=None, video_codec="h264", audio_codec="aac" if info.has_audio else None, has_audio=info.has_audio))

        # 3. signals
        ctx.progress("Detectando momentos relevantes", 16, "Actividad visual y picos de audio", force=True)
        act_t, act, bright = ff.gray_activity(src, info.duration)
        aud_t, aud = ff.audio_energy(src) if info.has_audio else (np.array([]), np.array([]))
        times, combined, motion, audio = intensity_curve(info.duration, act_t, act, aud_t, aud)
        skip = None
        if len(bright):
            b = np.interp(times, act_t, bright)
            skip = b < 8  # black / loading screens
        ctx.check_cancel()

        # 4-5. plan + extract frames
        segments, planned = plan_frames(info.duration, times, combined, motion, audio, segment_seconds=s.segment_seconds,
                                        max_total=s.max_frames_total, max_per_segment=s.max_frames_per_segment, skip_mask=skip)
        ctx.progress("Extrayendo fotogramas", 22, f"{len(planned)} fotogramas en {len(segments)} segmentos", force=True)
        frames_dir = work / "frames"
        frames_dir.mkdir(exist_ok=True)
        labels = [f"F{i + 1:04d}" for i in range(len(planned))]

        def extract(i: int):
            return ff.extract_frame(src, planned[i].t, frames_dir / f"{labels[i]}.jpg", s.frame_width)

        ok_flags = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            for n, okf in enumerate(pool.map(extract, range(len(planned)))):
                ok_flags.append(okf)
                if n % 10 == 0:
                    ctx.progress("Extrayendo fotogramas", 22 + 8 * n / max(1, len(planned)))
        frames = [(labels[i], planned[i]) for i in range(len(planned)) if ok_flags[i]]
        if not frames:
            raise PipelineError("No se pudo extraer ningún fotograma del vídeo.", "no_frames")
        frame_bytes = {lab: (frames_dir / f"{lab}.jpg").read_bytes() for lab, _ in frames}
        with session_scope() as db:
            for lab, fr in frames:
                key = f"{owner_id}/{match_id}/analyses/{analysis_id}/frames/{lab}.jpg"
                tmp = work / f"up-{lab}.jpg"
                shutil.copyfile(frames_dir / f"{lab}.jpg", tmp)
                st.put_file(tmp, key, "image/jpeg")
                db.add(Frame(owner_id=owner_id, analysis_id=analysis_id, label=lab, t=fr.t, segment_index=fr.segment, reason=fr.reason, storage_key=key))

        # 6. speech
        transcript: list[dict] = []
        stt_ok, stt_reason = stt.available()
        if info.has_audio and stt_ok:
            ctx.progress("Transcribiendo audio", 31, "Buscando comunicación de voz", force=True)
            wav = work / "audio.wav"
            if ff.extract_audio_wav(src, wav):
                transcript = stt.transcribe(wav)
        ctx.check_cancel()

        # 7. observation per segment
        frames_by_seg: dict[int, list[tuple[str, float, str]]] = {}
        for lab, fr in frames:
            frames_by_seg.setdefault(fr.segment, []).append((lab, fr.t, fr.reason))
        seg_ids = sorted(frames_by_seg)
        seg_results: dict[int, dict] = {}
        valid_labels = {lab for lab, _ in frames}
        ctx.progress("Análisis visual por segmentos", 35, f"0/{len(seg_ids)} segmentos", force=True)

        def observe(si: int):
            items = frames_by_seg[si]
            seg = segments[si]
            parts = [Part.t(f"SEGMENTO {si + 1}/{len(segments)} — de {fmt_t(seg.start)} a {fmt_t(seg.end)} del vídeo. Jugador analizado: {player_label}. {context}")]
            for lab, t, reason in items:
                parts.append(Part.t(f"{lab} @ {fmt_t(t)} ({'muestreo regular' if reason == 'baseline' else 'pico de actividad'})"))
                parts.append(Part.img(frame_bytes[lab]))
            parts.append(Part.t("Devuelve el JSON de observación del segmento. En 'frames' incluye todos los ids recibidos."))
            last = None
            for _ in range(3):
                try:
                    data, usage = provider.complete_json(prompts.SEGMENT_SYSTEM, parts, SEGMENT_SCHEMA)
                    return si, data, usage, None
                except ProviderError as e:
                    last = e
                    if not e.retryable:
                        break
            return si, None, None, last

        actx = AnalysisContext(source_type="video", provider=provider, player_label=player_label, match_context=context,
                               frame_loader=lambda lab: frame_bytes[lab])
        failed_segments = []
        with ThreadPoolExecutor(max_workers=max(1, s.vision_concurrency)) as pool:
            for n, (si, data, usage, err) in enumerate(pool.map(observe, seg_ids)):
                if err:
                    if err.code in ("ai_auth", "ai_model", "ai_permission", "ai_bad_request"):
                        raise PipelineError(err.message, err.code)
                    failed_segments.append(si)
                else:
                    seg_results[si] = data
                    actx.usage.add(usage)
                ctx.progress("Análisis visual por segmentos", 35 + 40 * (n + 1) / len(seg_ids), f"{n + 1}/{len(seg_ids)} segmentos")
        if not seg_results:
            raise PipelineError("La IA no pudo analizar ningún segmento del vídeo.", "vision_failed")

        # 8. timeline
        ctx.progress("Construyendo cronología", 76, force=True)
        frame_t = {lab: fr.t for lab, fr in frames}
        frame_reason = {lab: fr.reason for lab, fr in frames}
        timeline: list[dict] = []
        observations: list[dict] = []
        events: list[dict] = []
        content_types: dict[str, int] = {}
        quality: dict[str, int] = {}
        not_verifiable: list[str] = []
        seg_summaries = []
        for si in sorted(seg_results):
            d = seg_results[si]
            content_types[d["content_type"]] = content_types.get(d["content_type"], 0) + 1
            quality[d["image_quality"]] = quality.get(d["image_quality"], 0) + 1
            gameplay_seg = d["content_type"] in CONTENT_GAMEPLAY
            seg_summaries.append({"segment": si, "start": segments[si].start, "end": segments[si].end, "summary": d["segment_summary"], "content_type": d["content_type"]})
            not_verifiable += [f"[{fmt_t(segments[si].start)}] {x}" for x in d.get("not_verifiable", [])]
            for fo in d["frames"]:
                lab = fo["frame"]
                if lab not in valid_labels or lab in actx.evidence:
                    continue
                actx.evidence[lab] = Evidence(lab, frame_t[lab], "frame")
                item = {
                    "id": lab, "kind": "frame", "t": frame_t[lab], "segment": si, "reason": frame_reason[lab],
                    "gameplay": gameplay_seg and fo["situation"] not in ("menu_or_lobby", "spectating", "unknown"),
                    "situation": fo["situation"], "height": fo["height"], "cover": fo["cover"], "zone": fo["zone"],
                    "hud": {k: fo[k] for k in ("health", "shield", "wood", "brick", "metal", "players_remaining", "eliminations", "storm_info")},
                    "description": fo["description"],
                }
                timeline.append(item)
                actx.frame_items.append(item)
            # frames the model skipped still exist as evidence (seen by the model)
            for lab, t, _r in frames_by_seg[si]:
                if lab not in actx.evidence:
                    actx.evidence[lab] = Evidence(lab, t, "frame")
            for ev in d["events"]:
                ids = [x for x in ev["frames"] if x in valid_labels]
                if ids:
                    ts = sorted(frame_t[x] for x in ids)
                    events.append({"id": f"V{len(events) + 1:03d}", "kind": "event", "type": ev["type"], "t": ts[0], "t_end": ts[-1] if ts[-1] > ts[0] else None,
                                   "evidence": ids, "description": ev["description"], "confidence": ev["confidence"]})
            for ob in d["observations"]:
                ids = [x for x in ob["frames"] if x in valid_labels]
                if ids:
                    observations.append({"id": f"O{len(observations) + 1:03d}", "kind": "observation", "category": ob["category"], "obs_kind": ob["kind"],
                                         "t": min(frame_t[x] for x in ids), "frames": ids, "description": ob["description"], "confidence": ob["confidence"]})
        for i, tr in enumerate(transcript):
            tid = f"T{i + 1:03d}"
            actx.evidence[tid] = Evidence(tid, tr["t"], "speech", tr["t_end"])
            timeline.append({"id": tid, "kind": "speech", **tr})
        timeline += events
        timeline += [{**o, "kind": "observation"} for o in observations]
        timeline.sort(key=lambda x: (x["t"], x["id"]))

        phase_of, phase_method = _phase_fn(actx.frame_items)
        actx.phase_of = phase_of
        for it in actx.frame_items:
            it["phase"] = phase_of(it["t"])

        gameplay_frames = [f for f in actx.frame_items if f["gameplay"]]
        gameplay_segments = {f["segment"] for f in gameplay_frames}
        actx.analysed_minutes = sum(segments[i].end - segments[i].start for i in gameplay_segments) / 60.0
        actx.has_transcript = bool(transcript)
        actx.timeline_text = _timeline_text(actx.frame_items, events, observations, transcript, seg_summaries)

        # modules
        modules = ["positioning", "rotation", "fight", "endgame", "decision", "mechanics"]
        if transcript:
            modules.append("communication")
        else:
            actx.unavailable_modules["communication"] = (
                "El vídeo no tiene audio." if not info.has_audio else
                ("No se detectó voz en el audio." if stt_ok else stt_reason)
            )
        if not gameplay_frames:
            raise PipelineError(
                "No se ha detectado gameplay de Fortnite en el vídeo (solo menús, espectador u otro contenido). No se genera un análisis inventado.",
                "no_gameplay", match_status="incompatible",
            )
        actx.available_modules = modules
        ctx.progress("Módulos de coaching", 78, "Posicionamiento, rotaciones, peleas, endgame, decisiones, mecánicas", force=True)
        mod = engine.run_modules(actx, observations, [{"type": e["type"], "evidence": e["evidence"]} for e in events],
                                 lambda name, x: ctx.progress("Módulos de coaching", 78 + 14 * x, name), s.vision_concurrency)

        # scores + report
        stats = _video_stats(info, actx.frame_items, events, frames, segments, transcript)
        scores = engine.score(mod["findings"], mod["strengths"], mod["assessable"], actx.analysed_minutes)
        ctx.progress("Redactando informe", 93, force=True)
        report = engine.synthesize_report(actx, mod, scores, stats)
        report["module_summaries"] = mod["module_summaries"]
        report["not_assessable"] = mod["not_assessable"]
        report["strengths_evidence"] = mod["strengths"]

        coverage = {
            "duration_s": info.duration, "segments_total": len(segments), "segments_analysed": len(seg_results),
            "segments_failed": failed_segments, "frames": len(frames), "gameplay_frames": len(gameplay_frames),
            "analysed_minutes": round(actx.analysed_minutes, 1), "content_types": content_types, "image_quality": quality,
            "phase_method": phase_method, "has_audio": info.has_audio, "transcript_lines": len(transcript),
            "speech_to_text": stt_reason if not stt_ok else "ok", "not_verifiable": not_verifiable[:80],
            "dropped_unverified_claims": mod["dropped_unverified"], "segment_summaries": seg_summaries,
            "sampling": {"segment_seconds": s.segment_seconds, "max_frames_total": s.max_frames_total, "max_frames_per_segment": s.max_frames_per_segment},
        }
        save_analysis(analysis_id, match_id, owner_id, timeline, stats, scores, report, coverage, mod, actx.usage.as_dict())
        ctx.progress("Completado", 100, f"{len(mod['findings'])} errores verificados", force=True)
        return analysis_id
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _timeline_text(frames, events, observations, transcript, seg_summaries) -> str:
    lines = ["RESÚMENES DE SEGMENTO:"]
    lines += [f"S{x['segment'] + 1} {fmt_t(x['start'])}-{fmt_t(x['end'])} [{x['content_type']}]: {x['summary']}" for x in seg_summaries]
    lines.append("\nFOTOGRAMAS (id tiempo [fase/situación] HUD | altura cobertura zona | descripción):")
    for f in frames:
        h = f["hud"]
        hud = []
        if h["health"] is not None or h["shield"] is not None:
            hud.append(f"HP {h['health']}/{h['shield']}")
        if any(h[k] is not None for k in ("wood", "brick", "metal")):
            hud.append(f"mats {h['wood']}/{h['brick']}/{h['metal']}")
        if h["players_remaining"] is not None:
            hud.append(f"quedan {h['players_remaining']}")
        if h["eliminations"] is not None:
            hud.append(f"elims {h['eliminations']}")
        if h["storm_info"]:
            hud.append(f"tormenta '{h['storm_info']}'")
        lines.append(f"{f['id']} {fmt_t(f['t'])} [{f.get('phase')}/{f['situation']}] {' '.join(hud) or '-'} | {f['height']} {f['cover']} {f['zone']} | {f['description']}")
    lines.append("\nEVENTOS:")
    lines += [f"{e['id']} {fmt_t(e['t'])} {e['type']} ({','.join(e['evidence'])}, conf {e['confidence']}): {e['description']}" for e in events]
    lines.append("\nOBSERVACIONES PRELIMINARES:")
    lines += [f"{o['id']} {fmt_t(o['t'])} {o['obs_kind']}/{o['category']} ({','.join(o['frames'])}): {o['description']}" for o in observations]
    if transcript:
        lines.append("\nTRANSCRIPCIÓN DE VOZ:")
        lines += [f"T{i + 1:03d} {fmt_t(t['t'])}-{fmt_t(t['t_end'])}: {t['text']}" for i, t in enumerate(transcript)]
    return "\n".join(lines)


def _video_stats(info, frame_items, events, frames, segments, transcript) -> dict:
    hud_frames = [f for f in frame_items if f["gameplay"]]
    legible = [f for f in hud_frames if f["hud"]["health"] is not None]
    elims = [f["hud"]["eliminations"] for f in hud_frames if f["hud"]["eliminations"] is not None]
    left = [f["hud"]["players_remaining"] for f in hud_frames if f["hud"]["players_remaining"] is not None]
    sit: dict[str, int] = {}
    for f in hud_frames:
        sit[f["situation"]] = sit.get(f["situation"], 0) + 1
    count = lambda typ: sum(1 for e in events if e["type"] == typ)
    return {
        "source": "video",
        "duration_s": round(info.duration, 1),
        "resolution": f"{info.width}x{info.height}",
        "fps": info.fps,
        "frames_analysed": len(frames),
        "hud_legible_pct": round(100 * len(legible) / len(hud_frames)) if hud_frames else 0,
        "eliminations_hud_max": max(elims) if elims else None,
        "players_remaining_min": min(left) if left else None,
        "fights_detected": count("fight_start"),
        "enemy_knocks_seen": count("enemy_knocked"),
        "enemy_eliminations_seen": count("enemy_eliminated"),
        "player_knocked_seen": count("player_knocked"),
        "player_eliminated_seen": count("player_eliminated") > 0,
        "victory_seen": count("victory") > 0,
        "storm_damage_events": count("storm_damage"),
        "situation_share": {k: round(100 * v / len(hud_frames)) for k, v in sorted(sit.items(), key=lambda x: -x[1])} if hud_frames else {},
        "speech_lines": len(transcript),
        "note": "Valores leídos del HUD en fotogramas muestreados; null = no legible o no observado.",
    }
