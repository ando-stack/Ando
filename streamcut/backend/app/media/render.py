"""Renderizado de un EditSpec a MP4 (H.264 + AAC, faststart) con FFmpeg.

Cadena: segmentos (seek preciso) → concat → layout (reencuadre / blur / split) → zoom (zoompan)
→ fades → subtítulos ASS → audio (ganancia, reducción de ruido, loudnorm, limitador).
Al terminar se verifica la sincronía audio/vídeo con ffprobe.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from .editspec import EditSpec, Region
from .ffmpeg import MediaError, ProbeInfo, ffmpeg_bin, probe, run, video_encoder_args
from .subtitles import build_ass

log = logging.getLogger(__name__)
FPS = 30


@dataclass
class RenderResult:
    path: Path
    duration: float
    width: int
    height: int
    av_sync_diff: float


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def _crop_expr(region: Region, src_w: int, src_h: int, target_aspect: float | None = None) -> str:
    """crop=… sobre la región normalizada; si se indica aspecto, se ajusta centrado en la región."""
    x, y, w, h = region.x * src_w, region.y * src_h, region.w * src_w, region.h * src_h
    if target_aspect:
        cx, cy = x + w / 2, y + h / 2
        if w / h > target_aspect:
            w = h * target_aspect
        else:
            h = w / target_aspect
        x = min(max(0, cx - w / 2), src_w - w)
        y = min(max(0, cy - h / 2), src_h - h)
    return f"crop={_even(w)}:{_even(h)}:{int(x)}:{int(y)}"


def _fit(region: Region, src_w: int, src_h: int, target_aspect: float) -> tuple[float, float]:
    w, h = region.w * src_w, region.h * src_h
    if w / h > target_aspect:
        w = h * target_aspect
    else:
        h = w / target_aspect
    return w, h


def _piecewise(points: list[tuple[float, float]]) -> str:
    """Expresión de FFmpeg (variable t) que interpola linealmente entre puntos (t, valor)."""
    if len(points) == 1:
        return f"{points[0][1]:.1f}"
    terms = [f"lt(t,{points[0][0]:.3f})*{points[0][1]:.1f}"]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t1 - t0 < 1e-3:
            continue
        terms.append(f"gte(t,{t0:.3f})*lt(t,{t1:.3f})*({v0:.1f}+{(v1 - v0) / (t1 - t0):.3f}*(t-{t0:.3f}))")
    terms.append(f"gte(t,{points[-1][0]:.3f})*{points[-1][1]:.1f}")
    return "+".join(terms)


def _tracked_crop(region: Region, src_w: int, src_h: int, target_aspect: float, track: list[dict],
                  spec: EditSpec, bounds: Region | None = None) -> str:
    """crop con x/y animados para seguir la cara (puntos en tiempo del original → tiempo de salida)."""
    w, h = _fit(region, src_w, src_h, target_aspect)
    w, h = _even(w), _even(h)
    bx0, by0 = (bounds.x * src_w, bounds.y * src_h) if bounds else (0.0, 0.0)
    bx1, by1 = ((bounds.x + bounds.w) * src_w, (bounds.y + bounds.h) * src_h) if bounds else (src_w, src_h)
    if bx1 - bx0 < w:
        bx0, bx1 = 0.0, float(src_w)
    if by1 - by0 < h:
        by0, by1 = 0.0, float(src_h)
    px: list[tuple[float, float]] = []
    py: list[tuple[float, float]] = []
    for p in track:
        to = spec.to_output_time(p["t"])
        if to is None:
            continue
        px.append((to, min(max(bx0, p["x"] * src_w - w / 2), bx1 - w)))
        py.append((to, min(max(by0, p["y"] * src_h - h / 2), by1 - h)))
    if not px:
        return _crop_expr(region, src_w, src_h, target_aspect)
    return (f"crop={w}:{h}:x='clip({_piecewise(px)},0,{src_w - w})':y='clip({_piecewise(py)},0,{src_h - h})'")


def _zoom_expr(spec: EditSpec) -> str | None:
    if not spec.zoom.enabled or not spec.zoom.punch_ins:
        return None
    terms = []
    ease = 0.25
    for p in spec.zoom.punch_ins:
        t0, t1 = p.t, p.t + p.duration
        # rampa de entrada y salida (ease) para que el zoom sea suave
        ramp = (f"min(1,max(0,(it-{t0:.3f})/{ease}))*min(1,max(0,({t1:.3f}-it)/{ease}))")
        terms.append(f"{p.scale - 1:.3f}*{ramp}")
    return "1+" + "+".join(terms)


EMOJI_DIR = Path(__file__).parent / "assets" / "emoji"


def emoji_path(name: str) -> Path:
    p = EMOJI_DIR / f"{name}.png"
    if not p.exists():
        raise MediaError(f"Falta la imagen del emote {name}")
    return p


def build_filter(spec: EditSpec, info: ProbeInfo, ass_path: Path | None,
                 overlay_inputs: list[int] | None = None,
                 tracks: dict[str, list[dict]] | None = None) -> tuple[str, list[str]]:
    W, H = spec.size()
    sw, sh = info.width or W, info.height or H
    n = len(spec.segments)
    parts: list[str] = []
    for i in range(n):
        parts.append(f"[{i}:v:0]setpts=PTS-STARTPTS,fps={FPS},format=yuv420p,setsar=1[v{i}]")
        if info.has_audio:
            parts.append(f"[{i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a{i}]")
        else:
            d = spec.segments[i].end - spec.segments[i].start
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{d:.3f}[a{i}]")
    parts.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[cv][ca]")

    lay = spec.layout
    aspect = W / H
    tracks = tracks or {}
    if lay.mode == "crop":
        crop = (_tracked_crop(lay.main, sw, sh, aspect, tracks["main"], spec) if tracks.get("main")
                else _crop_expr(lay.main, sw, sh, aspect))
        parts.append(f"[cv]{crop},scale={W}:{H}[lv]")
    elif lay.mode == "split" and lay.webcam is not None:
        top_h = _even(H * lay.split_ratio)
        bot_h = H - top_h
        parts.append("[cv]split=2[cw][cg]")
        cam = (_tracked_crop(lay.webcam, sw, sh, W / top_h, tracks["webcam"], spec, bounds=lay.webcam)
               if tracks.get("webcam") else _crop_expr(lay.webcam, sw, sh, W / top_h))
        parts.append(f"[cw]{cam},scale={W}:{top_h}[top]")
        parts.append(f"[cg]{_crop_expr(lay.main, sw, sh, W / bot_h)},scale={W}:{bot_h}[bot]")
        parts.append("[top][bot]vstack=inputs=2[lv]")
    elif lay.mode == "fit_black":
        parts.append(f"[cv]{_crop_expr(lay.main, sw, sh)},scale={W}:{H}:force_original_aspect_ratio=decrease,"
                     f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black[lv]")
    else:  # fit_blur (por defecto) o split sin webcam detectada
        crop = _crop_expr(lay.main, sw, sh)
        parts.append(f"[cv]{crop},split=2[bgsrc][fgsrc]")
        parts.append(f"[bgsrc]scale={_even(W / 4)}:{_even(H / 4)}:force_original_aspect_ratio=increase,"
                     f"crop={_even(W / 4)}:{_even(H / 4)},boxblur=10:2,eq=brightness=-0.12,scale={W}:{H}[bg]")
        parts.append(f"[fgsrc]scale={W}:{H}:force_original_aspect_ratio=decrease[fg]")
        parts.append("[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[lv]")

    chain = "[lv]"
    zexpr = _zoom_expr(spec)
    if zexpr:
        parts.append(f"[lv]zoompan=z='{zexpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}[zv]")
        chain = "[zv]"
    # Emotes: imágenes PNG con transparencia que aparecen y desaparecen con un fundido
    for k, (ov, idx) in enumerate(zip(spec.overlays, overlay_inputs or [])):
        size = _even(W * ov.size)
        t0, t1 = ov.t, ov.t + ov.duration
        parts.append(f"[{idx}:v]format=rgba,scale={size}:{size},fade=t=in:st={t0:.3f}:d=0.15:alpha=1,"
                     f"fade=t=out:st={max(t0, t1 - 0.25):.3f}:d=0.25:alpha=1[em{k}]")
        x = int(min(max(0, W * ov.x - size / 2), W - size))
        y = int(min(max(0, H * ov.y - size / 2), H - size))
        parts.append(f"{chain}[em{k}]overlay=x={x}:y={y}:enable='between(t,{t0:.3f},{t1:.3f})'"
                     f":eof_action=pass:format=auto[ov{k}]")
        chain = f"[ov{k}]"
    post: list[str] = []
    total = spec.output_duration
    if spec.fades.video_in > 0:
        post.append(f"fade=t=in:st=0:d={spec.fades.video_in:.3f}")
    if spec.fades.video_out > 0 and total > spec.fades.video_out * 2:
        post.append(f"fade=t=out:st={total - spec.fades.video_out:.3f}:d={spec.fades.video_out:.3f}")
    if ass_path is not None:
        p = ass_path.as_posix().replace(":", r"\:").replace("'", r"\'")
        fontsdir = os.environ.get("STREAMCUT_FONTS_DIR")
        post.append(f"ass='{p}'" + (f":fontsdir='{Path(fontsdir).as_posix()}'" if fontsdir else ""))
    post.append("format=yuv420p")
    parts.append(chain + ",".join(post) + "[outv]")

    a = spec.audio
    afilters: list[str] = []
    if a.gain_db:
        afilters.append(f"volume={a.gain_db:.2f}dB")
    if a.denoise:
        afilters.append("afftdn=nf=-25")
    if a.normalize:
        afilters.append(f"loudnorm=I={a.target_lufs:.1f}:TP=-1.5:LRA=11")
    if a.limiter:
        afilters.append("alimiter=limit=0.95")
    if spec.fades.video_in > 0:
        afilters.append(f"afade=t=in:st=0:d={min(0.1, spec.fades.video_in):.3f}")
    if spec.fades.video_out > 0 and total > spec.fades.video_out * 2:
        afilters.append(f"afade=t=out:st={total - spec.fades.video_out:.3f}:d={spec.fades.video_out:.3f}")
    afilters.append("aresample=48000")
    parts.append("[ca]" + ",".join(afilters) + "[outa]")
    return ";".join(parts), ["-map", "[outv]", "-map", "[outa]"]


def face_tracks(spec: EditSpec, src: Path, info: ProbeInfo, cache_dir: Path | None) -> dict[str, list[dict]]:
    """Trayectorias de cara para el layout del spec (vacío si no hay seguimiento o no se ven caras)."""
    lay = spec.layout
    if not lay.face_track or lay.mode not in ("crop", "split"):
        return {}
    from . import facetrack
    a, b = min(s.start for s in spec.segments), max(s.end for s in spec.segments)
    try:
        dets = facetrack.detections(src, a, b, info.width, info.height, cache_dir)
    except Exception as exc:  # el seguimiento nunca debe impedir el render
        log.warning("Seguimiento de cara no disponible: %s", exc)
        return {}
    if lay.mode == "crop":
        return {"main": facetrack.build_track(dets)}
    if lay.webcam is not None:
        return {"webcam": facetrack.build_track(dets, zone=lay.webcam.model_dump())}
    return {}


def render(spec: EditSpec, src: Path, dest: Path, workdir: Path, *, cancel=None, progress=None,
           track_cache: Path | None = None) -> RenderResult:
    info = probe(src)
    if not info.has_video:
        raise MediaError("La fuente no tiene vídeo")
    for s in spec.segments:
        if s.start >= info.duration:
            raise MediaError("Un segmento empieza después del final del vídeo original")
    segs = [s.model_copy(update={"end": min(s.end, info.duration)}) for s in spec.segments]
    spec = spec.model_copy(update={"segments": segs})
    ass_path = None
    if (spec.subtitles.enabled and spec.subtitles.cues) or (spec.title_card.enabled and spec.title_card.text.strip()):
        ass_path = workdir / "subs.ass"
        ass_path.write_text(build_ass(spec), encoding="utf-8")
    total = spec.output_duration
    overlays = [o for o in spec.overlays if o.t < total]
    spec = spec.model_copy(update={"overlays": overlays})
    n = len(spec.segments)
    tracks = face_tracks(spec, src, info, track_cache)
    graph, maps = build_filter(spec, info, ass_path, list(range(n, n + len(overlays))), tracks)
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y"]
    for s in spec.segments:
        cmd += ["-ss", f"{s.start:.3f}", "-t", f"{s.end - s.start:.3f}", "-i", str(src)]
    for ov in overlays:
        cmd += ["-loop", "1", "-framerate", str(FPS), "-t", f"{total:.3f}", "-i", str(emoji_path(ov.name))]
    cmd += ["-filter_complex", graph, *maps, *video_encoder_args(20, "medium"), "-r", str(FPS),
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-t", f"{total:.3f}",
            "-movflags", "+faststart", "-progress", "pipe:2", "-nostats", str(dest)]
    run(cmd, cancel=cancel, progress=progress, duration=total)
    out = probe(dest)
    vdur = adur = out.duration
    for st in out.raw.get("streams", []):
        if st.get("codec_type") == "video" and st.get("duration"):
            vdur = float(st["duration"])
        if st.get("codec_type") == "audio" and st.get("duration"):
            adur = float(st["duration"])
    diff = abs(vdur - adur)
    if not out.has_video or not out.has_audio:
        raise MediaError("El render no contiene audio y vídeo")
    if diff > 0.15:
        raise MediaError(f"Desincronía audio/vídeo de {diff:.2f}s en el render")
    return RenderResult(dest, out.duration, out.width or 0, out.height or 0, round(diff, 3))
