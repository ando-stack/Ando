"""Editor IA: edición automática y profesional de clips completos.

A partir del audio, la transcripción (con tiempos por palabra), la semántica y la imagen decide:
- Encuadre vertical (webcam + juego en split si detecta webcam; cara centrada o fondo difuminado).
- Cortes de silencios muertos (jump cuts) sin partir palabras.
- Subtítulos «de vez en cuando»: solo en las frases importantes (o completos/ninguno, configurable).
- Pocos emotes, colocados en las reacciones reales (risas, gritos, victorias, fallos), espaciados.
- Zoom suave en la reacción más fuerte y título gancho al inicio.
- Audio normalizado (EBU R128) con limitador.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis import audio as audio_mod
from app.analysis import semantic, transcribe
from app.core.config import get_settings
from app.db.models import AnalysisJob, Clip, ClipVersion, IngestionJob, SourceAsset, TranscriptSegment
from app.db.session import SessionLocal
from app.media import ffmpeg as ff
from app.media.editspec import EditSpec, cues_from_words
from app.storage import get_storage

from .bus import publish
from .jobs import JobContext
from .settings import get_settings_data
from .templates import build_spec, get_template

log = logging.getLogger(__name__)

DEFAULT_OPTIONS: dict[str, Any] = {
    "format": "9:16",
    "style": "gaming-viral",  # plantilla de estilo (encuadre y tipografía)
    "subtitles": "key",  # key = solo frases importantes · full = todo · none
    "emotes": "few",  # few = pocos (1-2) · normal (hasta 4) · none
    "cut_silences": True,
    "zoom": True,
    "hook_title": True,
    "denoise": False,
}

# Emote según el tipo de reacción (variando para no repetir siempre el mismo)
EMOTE_FOR = {
    "laughter": ["laugh", "rofl"], "funny": ["laugh", "rofl"], "scream": ["shock"], "scare": ["shock"],
    "loud_reaction": ["flushed", "shock"], "reaction": ["flushed", "eyes"], "victory": ["fire", "hundred"],
    "hype": ["fire"], "epic_play": ["fire", "cool"], "fail": ["skull"], "defeat": ["skull", "cry"],
}


@dataclass
class Plan:
    spec: EditSpec
    summary: dict[str, Any] = field(default_factory=dict)


def _kept_segments(start: float, end: float, silences: list[tuple[float, float]], words: list[dict],
                   pad: float = 0.25) -> list[dict]:
    """Quita silencios largos sin cortar palabras; devuelve segmentos en tiempo absoluto."""
    cuts: list[tuple[float, float]] = []
    for a, b in silences:
        a, b = max(a, start), min(b, end)
        if b - a < 1.2:
            continue
        ca, cb = a + pad, b - pad
        # nunca dentro de una palabra
        for w in words:
            if w["start"] < cb and w["end"] > ca:
                if w["start"] <= ca:
                    ca = w["end"] + 0.05
                if w["end"] >= cb:
                    cb = w["start"] - 0.05
        if cb - ca >= 0.6:
            cuts.append((ca, cb))
    segs, cur = [], start
    for a, b in sorted(cuts):
        if a - cur >= 0.4:
            segs.append({"start": round(cur, 3), "end": round(a, 3)})
        cur = max(cur, b)
    if end - cur >= 0.4:
        segs.append({"start": round(cur, 3), "end": round(end, 3)})
    if not segs:
        segs = [{"start": round(start, 3), "end": round(end, 3)}]
    return segs[:50]


def _key_segments(segments: list[transcribe.Segment], events: list[audio_mod.AudioEvent]) -> list[transcribe.Segment]:
    """Frases que merecen subtítulo: interés semántico, exclamaciones o reacción en el audio."""
    if not segments:
        return []
    scores = semantic.score_segments(segments)
    picked = []
    for seg, sc in zip(segments, scores):
        reacts = any(e.type in ("loud_reaction", "scream", "laughter") and e.start < seg.end + 0.5
                     and e.end > seg.start - 0.5 for e in events)
        if sc.interest >= 0.35 or reacts or "!" in seg.text or "¡" in seg.text:
            picked.append(seg)
    if not picked:  # al menos las frases más interesantes
        ranked = sorted(zip(segments, scores), key=lambda x: x[1].interest, reverse=True)
        picked = [s for s, _ in ranked[: max(1, len(segments) // 3)]]
    # «de vez en cuando»: como mucho ~60 % de las frases
    limit = max(1, int(round(len(segments) * 0.6)))
    if len(picked) > limit:
        idx = {id(s): i for i, s in enumerate(segments)}
        pri = {id(s): sc.interest for s, sc in zip(segments, scores)}
        picked = sorted(sorted(picked, key=lambda s: pri[id(s)], reverse=True)[:limit], key=lambda s: idx[id(s)])
    return picked


def _short_hook(text: str, limit: int = 40) -> str:
    """Título gancho corto, cortado por palabras completas."""
    text = " ".join(text.replace("\n", " ").split()).strip(" .,;:-")
    if len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0]
        text = (cut or text[:limit]).rstrip(" ,;:-") + "…"
    return text.upper()


def plan_edit(*, asset_id: str, start: float, end: float, words: list[dict], segments: list[transcribe.Segment],
              audio: audio_mod.AudioFeatures | None, audio_offset: float, template_spec: dict[str, Any],
              source_w: int | None, source_h: int | None, webcam: dict | None, faces: list | None,
              options: dict[str, Any], fallback_title: str) -> Plan:
    o = {**DEFAULT_OPTIONS, **(options or {})}
    events: list[audio_mod.AudioEvent] = []
    silences: list[tuple[float, float]] = []
    if audio is not None:
        for e in audio_mod.detect_events(audio):
            ev = audio_mod.AudioEvent(e.type, e.start + audio_offset, e.end + audio_offset, e.confidence, e.value,
                                      e.label)
            (silences.append((ev.start, ev.end)) if ev.type == "silence" else events.append(ev))
    segs_in = [s for s in segments if s.end > start and s.start < end]
    kept = _kept_segments(start, end, silences, words) if o["cut_silences"] else [{"start": start, "end": end}]

    best_peak = max((e for e in events if e.type != "silence"), key=lambda e: e.confidence * (1 + e.value / 10),
                    default=None)
    base = build_spec(template_spec, source_asset_id=asset_id, start=start, end=end, words=[],
                      peak=best_peak.start if best_peak else None, source_w=source_w, source_h=source_h,
                      webcam=webcam, faces=faces, auto_edit=True, format_override=o["format"],
                      subtitles_override=o["subtitles"] != "none")
    spec_d = base.model_dump(mode="json")
    spec_d["segments"] = kept
    spec_d["zoom"] = {"enabled": False, "punch_ins": []}
    spec_d["audio"] = {**spec_d["audio"], "normalize": True, "limiter": True, "denoise": bool(o["denoise"])}
    spec = EditSpec.model_validate(spec_d)

    # Subtítulos
    style = spec.subtitles.style.model_copy(update={"uppercase": True, "animation": "pop"})
    cues: list[dict] = []
    if o["subtitles"] == "full":
        cues = cues_from_words(words, start, end, style.words_per_line)
    elif o["subtitles"] == "key":
        for seg in _key_segments(segs_in, events):
            cues += cues_from_words(words, seg.start - 0.05, seg.end + 0.05, style.words_per_line)
    cues = [c for c in cues if spec.to_output_time(c["start"]) is not None
            or spec.to_output_time(c["end"]) is not None]
    d0 = spec.model_dump(mode="json")
    d0["subtitles"] = {"enabled": bool(cues), "style": style.model_dump(mode="json"), "cues": cues}
    spec = EditSpec.model_validate(d0)

    # Título gancho
    hook = ""
    if o["hook_title"]:
        best_text = ""
        if segs_in:
            sc = semantic.score_segments(segs_in)
            best_text = max(zip(segs_in, sc), key=lambda x: x[1].interest)[0].text
        hook = _short_hook(semantic.generate_title(best_text, "reaction", max_len=80) if best_text else fallback_title)
    hook_end = 2.8 if hook else 0.0

    # Momentos de reacción (audio + semántica) para emotes y zoom
    moments: list[tuple[float, float, str]] = []  # (t_origen, fuerza, tipo)
    for e in events:
        if e.type in ("laughter", "scream", "loud_reaction"):
            moments.append((e.start + 0.3, e.confidence * (1.2 if e.type == "laughter" else 1.0), e.type))
    for seg, sc in zip(segs_in, semantic.score_segments(segs_in)):
        if sc.categories:
            cat = max(sc.categories, key=sc.categories.get)
            if cat in EMOTE_FOR and sc.interest >= 0.5:
                moments.append((min(seg.end, seg.start + 0.6), sc.interest * 0.9, cat))
    moments.sort(key=lambda m: m[1], reverse=True)

    out_dur = spec.output_duration
    max_emotes = {"none": 0, "few": int(min(2, max(1, out_dur // 15))),
                  "normal": int(min(4, max(1, out_dur // 8)))}.get(o["emotes"], 1)
    overlays: list[dict] = []
    used: dict[str, int] = {}
    split = spec.layout.mode == "split" and spec.layout.webcam is not None
    sub_mid = spec.subtitles.style.position == "middle"
    y = 0.74 if split or sub_mid else 0.2
    if split and sub_mid:
        y = 0.8
    for t_src, strength, kind in moments:
        if len(overlays) >= max_emotes:
            break
        t = spec.to_output_time(t_src)
        if t is None or t < hook_end or t > out_dur - 1.0 or strength < 0.45:
            continue
        if any(abs(t - ov["t"]) < 6.0 for ov in overlays):
            continue
        options_ = EMOTE_FOR.get(kind, ["fire"])
        name = options_[used.get(kind, 0) % len(options_)]
        used[kind] = used.get(kind, 0) + 1
        overlays.append({"name": name, "t": round(t, 2), "duration": 1.6, "x": 0.8 if len(overlays) % 2 == 0 else 0.2,
                         "y": y, "size": 0.2})

    punch: list[dict] = []
    if o["zoom"]:
        for t_src, strength, kind in moments:
            if len(punch) >= 2:
                break
            t = spec.to_output_time(t_src - 0.3)
            if t is None or t < hook_end * 0.5 or t > out_dur - 1.6 or strength < 0.5:
                continue
            if any(abs(t - p["t"]) < 8 for p in punch):
                continue
            punch.append({"t": round(t, 2), "duration": 1.4, "scale": 1.12})

    final = spec.model_copy(update={})
    d = final.model_dump(mode="json")
    d["overlays"] = overlays
    d["zoom"] = {"enabled": bool(punch), "punch_ins": punch}
    d["title_card"] = {"enabled": bool(hook), "text": hook, "duration": 2.6}
    d["fades"] = {"video_in": 0.12, "video_out": 0.25}
    final = EditSpec.model_validate(d)
    removed = (end - start) - final.output_duration
    summary = {"duration": round(final.output_duration, 2), "removed_seconds": round(max(0.0, removed), 2),
               "cuts": max(0, len(final.segments) - 1), "captions": len(final.subtitles.cues),
               "caption_mode": o["subtitles"], "emotes": [ov["name"] for ov in overlays], "zooms": len(punch),
               "layout": final.layout.mode, "hook": hook, "format": final.format}
    return Plan(final, summary)


# ---------------------------------------------------------------------------
# Trabajo
# ---------------------------------------------------------------------------

def editor_options(db: Session, workspace_id: uuid.UUID, override: dict | None = None) -> dict[str, Any]:
    cfg = get_settings_data(db, workspace_id).get("ai_editor", {})
    return {**DEFAULT_OPTIONS, **cfg, **{k: v for k, v in (override or {}).items() if k in DEFAULT_OPTIONS}}


def _ensure_transcript(db: Session, asset: SourceAsset, wav, start: float, end: float) -> None:
    have = db.scalar(select(TranscriptSegment.id).where(TranscriptSegment.source_asset_id == asset.id,
                                                        TranscriptSegment.end > start,
                                                        TranscriptSegment.start < end).limit(1))
    if have or not get_settings().transcription_enabled or not transcribe.available():
        return
    samples = ff.read_pcm(wav, start, end - start)
    tr = transcribe.transcribe_samples(samples, offset=start)
    for s in tr.segments:
        db.add(TranscriptSegment(source_asset_id=asset.id, start=s.start, end=s.end, text=s.text,
                                 language=tr.language, confidence=s.confidence,
                                 words=[{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.text,
                                         "prob": round(w.prob, 3)} for w in s.words]))
    db.commit()


def run_ai_edit(job_id: uuid.UUID) -> None:
    from app.workers.dispatch import enqueue_analysis

    from .pipeline import media_of, queue_render, segments_from_db, words_in

    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None or job.status in ("succeeded", "cancelled"):
            return
        asset = db.get(SourceAsset, job.source_asset_id) if job.source_asset_id else None
        if asset is not None and asset.status in ("uploaded", "processing"):
            pending = db.scalar(select(IngestionJob.id).where(IngestionJob.source_asset_id == asset.id,
                                                             IngestionJob.status.in_(("queued", "running"))))
            if pending and not job.cancel_requested:
                enqueue_analysis(job_id, delay_ms=8000)  # el vídeo aún se está preparando
                return
    ctx = JobContext("analysis", job_id)
    if not ctx.start():
        return
    t0 = time.monotonic()
    storage = get_storage()
    try:
        with SessionLocal() as db:
            job = db.get(AnalysisJob, job_id)
            clip = db.get(Clip, uuid.UUID(job.params["clip_id"]))
            asset = db.get(SourceAsset, job.source_asset_id)
            if clip is None or asset is None or asset.status != "ready":
                raise RuntimeError("El vídeo del clip no está disponible para editar")
            opts = editor_options(db, clip.workspace_id, job.params.get("options"))
            start = max(0.0, float(clip.start or 0.0))
            end = float(clip.end if clip.end and clip.end > start else asset.duration or 0.0)
            end = min(end, float(asset.duration or end))
            if end - start < 1.0:
                raise RuntimeError("El clip es demasiado corto para editarlo")
            audio_m = media_of(db, asset.id, "audio")
            feats = None
            if audio_m is not None:
                ctx.progress(0.05, "Escuchando el audio", force=True)
                with storage.as_local(audio_m.storage_key) as wav:
                    feats = audio_mod.compute_features(ff.read_pcm(wav, start, end - start))
                    ctx.progress(0.15, "Transcribiendo", force=True)
                    _ensure_transcript(db, asset, wav, start, end)
            if ctx.cancelled():
                ctx.finish("cancelled")
                return
            ctx.progress(0.6, "Decidiendo cortes, subtítulos y emotes", force=True)
            an = db.scalar(select(AnalysisJob).where(AnalysisJob.source_asset_id == asset.id,
                                                     AnalysisJob.kind == "full", AnalysisJob.status == "succeeded")
                           .order_by(AnalysisJob.created_at.desc()))
            res = an.result if an else {}
            tpl = get_template(db, clip.workspace_id, slug=opts["style"]) or \
                get_template(db, clip.workspace_id, slug="gaming-viral")
            plan = plan_edit(asset_id=str(asset.id), start=start, end=end, words=words_in(db, asset.id, start, end),
                             segments=segments_from_db(db, asset.id), audio=feats, audio_offset=start,
                             template_spec=tpl.spec if tpl else {}, source_w=asset.width, source_h=asset.height,
                             webcam=res.get("webcam_region"), faces=res.get("faces"), options=opts,
                             fallback_title=clip.title)
            n = (max((v.version_no for v in clip.versions), default=0)) + 1
            version = ClipVersion(clip_id=clip.id, version_no=n, edit_spec=plan.spec.model_dump(mode="json"),
                                  status="draft", note="Edición IA")
            db.add(version)
            db.flush()
            clip.current_version_id = version.id
            clip.format = plan.spec.format
            clip.platform_data = {**(clip.platform_data or {}), "ai_edit": plan.summary}
            db.commit()
            queue_render(db, clip, version, priority=2)
            plan.summary["processing_seconds"] = round(time.monotonic() - t0, 2)
            plan.summary["version"] = n
            publish(clip.workspace_id, "clip", {"id": str(clip.id), "status": clip.status, "title": clip.title})
        ctx.finish("succeeded", result=plan.summary)
    except Exception as exc:
        log.exception("Edición IA fallida")
        ctx.log("error", f"Edición IA fallida: {exc}")
        ctx.finish("failed", str(exc))
