"""Fase 2: edición automática completa. Cada paso es independiente: si uno falla, se avisa y se
continúa con el resto. Todo lo que se añade queda como elementos editables en project.json."""
from __future__ import annotations

import copy
import re
import traceback
from pathlib import Path

import ai_editor
import audio
import cleanup
import color
import project_ops as ops
from config import ASSETS_DIR, ai_available
from utils import Cancelled, fmt_time, new_id

TEXT_STYLES = {
    "titulo": {"font": "Anton", "fontSize": 0.11, "color": "#FFFFFF", "background": None,
               "strokeColor": "#000000", "bold": True, "uppercase": True},
    "texto": {"font": "Montserrat", "fontSize": 0.06, "color": "#FFFFFF", "background": "#E6007ED9",
              "strokeColor": None, "bold": True, "uppercase": False},
    "dato": {"font": "Poppins", "fontSize": 0.065, "color": "#111111", "background": "#FFD400F0",
             "strokeColor": None, "bold": True, "uppercase": False},
}
TEXT_POS = {"titulo": (0.5, 0.18), "texto": (0.5, 0.66), "dato": (0.25, 0.22)}
EMOJI_SPOTS = [(0.82, 0.25), (0.18, 0.28), (0.8, 0.6), (0.2, 0.58)]


# ====================================================================== subtítulos
def build_captions(words: list[dict], max_words: int = 4) -> list[dict]:
    blocks, cur = [], []

    def flush():
        if cur:
            blocks.append({"id": new_id("sub"), "start": cur[0]["start"], "end": cur[-1]["end"],
                           "words": [{"text": w["text"], "start": w["start"], "end": w["end"]} for w in cur]})

    for i, w in enumerate(words):
        if cur and (len(cur) >= max_words or w["start"] - cur[-1]["end"] > 0.45):
            flush()
            cur = []
        cur.append(w)
        if re.search(r"[.!?…]$", w["text"]):
            flush()
            cur = []
    flush()
    # mantener cada bloque en pantalla hasta el siguiente (máx. 0.4 s extra) y duración mínima
    for a, b in zip(blocks, blocks[1:] + [None]):
        nxt = b["start"] if b else a["end"] + 0.4
        a["end"] = round(min(max(a["end"] + 0.15, a["start"] + 0.3), nxt, a["end"] + 0.4), 3)
        a["start"] = round(a["start"], 3)
        if a["end"] - a["start"] < 0.05:
            a["end"] = round(a["start"] + 0.05, 3)
    return blocks


def phrases_out(words: list[dict]) -> list[dict]:
    ph = cleanup.phrases(words)
    return [{"start": round(p["start"], 2), "end": round(p["end"], 2), "text": p["text"]} for p in ph]


def cut_points(p: dict) -> list[float]:
    return [round(b, 3) for _s, _a, b in ops.segment_spans(p)[:-1]]


def face_center(p: dict, source_id: str, t: float) -> tuple[float, float] | None:
    import faces
    for tr in p["faces"]["tracks"][:1]:
        for part in tr["parts"]:
            if part["sourceId"] == source_id:
                b = faces.box_at(part["samples"], t)
                if b:
                    return (b[0] + b[2] / 2, b[1] + b[3] / 2)
    return None


def pick_sfx(kind: str) -> str | None:
    files = audio.list_library("sfx")
    if not files:
        return None
    keys = {"transicion": ("whoosh", "swoosh", "trans", "swipe"), "texto": ("pop", "click", "ding", "texto")}[kind]
    for f in files:
        if any(k in f.lower() for k in keys):
            return f
    return files[0]


# ====================================================================== pipeline
def run(proj_dir: Path, p: dict, settings: dict, job) -> tuple[dict, dict]:
    p = copy.deepcopy(p)
    p["autoEdit"] = {**p["autoEdit"], **settings}
    s = p["autoEdit"]
    warnings: list[str] = []
    done: list[str] = []

    def step(name, fn, a, b):
        nonlocal p
        job.update(a, name)
        try:
            r = fn(job.sub(a, b))
            if r is not None:
                p = r
        except Cancelled:
            raise
        except ai_editor.AIUnavailable as e:
            warnings.append(f"{name}: {e}")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            warnings.append(f"No se pudo aplicar «{name}»: {e}")

    # ------------------------------------------------ 1. limpieza (silencios, muletillas, tomas falsas)
    def do_cleanup(prog):
        p["texts"], p["emojis"], p["zooms"], p["transitions"] = [], [], [], []
        p["captions"]["blocks"], p["audio"]["sfx"], p["faces"]["pixelate"] = [], [], []
        segments, cuts, t = [], [], 0.0
        n = len(p["sources"])
        for i, src in enumerate(p["sources"]):
            words = [w for w in p["transcript"] if w["sourceId"] == src["id"]]
            sil = cleanup.detect_silences(proj_dir / "audio" / f"{src['id']}.wav", s["silenceThresholdDb"],
                                          min(s["minSilence"], 0.3), proj_dir) if s["silences"] else []
            keep, removals = cleanup.plan_source(words, sil, src["duration"], s)
            if not keep:
                keep = [(0.0, src["duration"])]
            for a, b in keep:
                if segments:
                    cuts.append({"at": round(t, 3), "reason": "corte"})
                segments.append({"id": new_id("seg"), "sourceId": src["id"], "inPoint": a, "outPoint": b})
                t += b - a
            for r in removals:
                if r["reason"] != "silencio":
                    done.append(f"Quitado ({r['reason']}): «{r.get('text', '')[:40]}» en {src['name']}")
            prog((i + 1) / n)
        removed = sum(x["duration"] for x in p["sources"]) - t
        p["segments"], p["cuts"] = segments, cuts
        done.append(f"Limpieza: {removed:.1f} s eliminados (silencios, muletillas y tomas falsas)")
        return p

    if s["silences"] or s["fillers"] or s["retakes"]:
        step("Eliminando silencios y errores", do_cleanup, 0.0, 0.15)
    else:
        p["segments"] = [{"id": new_id("seg"), "sourceId": x["id"], "inPoint": 0.0, "outPoint": x["duration"]}
                         for x in p["sources"]]

    # ------------------------------------------------ 2. subtítulos
    def do_captions(prog):
        words = ops.output_words(p)
        p["captions"]["style"]["preset"] = s["captionPreset"]
        p["captions"]["blocks"] = build_captions(words, p["captions"]["style"]["maxWords"])
        done.append(f"Subtítulos: {len(p['captions']['blocks'])} bloques sincronizados palabra a palabra")
        return p

    if s["subtitles"]:
        step("Creando subtítulos", do_captions, 0.15, 0.2)

    # ------------------------------------------------ 3. decisiones creativas con Claude
    removals_out: list[tuple[float, float, str]] = []

    def do_creative(prog):
        if not ai_available():
            raise ai_editor.AIUnavailable("sin clave de API: títulos, emojis, zooms suaves y transiciones "
                                          "creativas no disponibles (se aplican solo los pasos automáticos)")
        words = ops.output_words(p)
        total = ops.duration(p)
        cuts = cut_points(p)
        dec = ai_editor.creative_decisions(phrases_out(words), cuts, total, s)
        dec, notes = ai_editor.validate_decisions(dec, total, cuts, s)
        warnings.extend(notes)
        cat = {e["emoji"]: e["file"] for e in ai_editor.emoji_catalog()}
        if s["texts"]:
            for t in dec.titulos:
                x, y = TEXT_POS[t.tipo]
                p["texts"].append({"id": new_id("txt"), "start": round(t.inicio, 3), "end": round(t.fin, 3),
                                   "text": t.texto, "kind": t.tipo, "x": x, "y": y,
                                   "animation": "pop" if t.tipo != "titulo" else "slide-up",
                                   "style": dict(TEXT_STYLES[t.tipo])})
        if s["emojis"]:
            for i, e in enumerate(dec.emojis):
                x, y = EMOJI_SPOTS[i % len(EMOJI_SPOTS)]
                p["emojis"].append({"id": new_id("emo"), "start": round(e.tiempo, 3),
                                    "end": round(min(total, e.tiempo + e.duracion), 3), "emoji": e.emoji,
                                    "file": cat[e.emoji], "x": x, "y": y, "size": 0.14, "rotation": 0,
                                    "animation": "pop"})
        if s["smoothZooms"]:
            for z in dec.zooms:
                p["zooms"].append({"id": new_id("zoom"), "start": round(z.inicio, 3), "end": round(z.fin, 3),
                                   "kind": "smooth", "scale": round(1 + (z.escala - 1) * (0.5 + s["intensity"]), 3),
                                   "x": 0.5, "y": 0.42})
        if s["transitions"]:
            for tr in dec.transiciones:
                p["transitions"].append({"id": new_id("trans"), "at": tr.tiempo, "duration": 0.4, "type": tr.tipo})
        if s["retakes"]:
            removals_out.extend((q.inicio, q.fin, q.motivo) for q in dec.quitar)
        done.append(f"IA: {len(dec.titulos)} textos, {len(p['emojis'])} emojis, {len(dec.zooms)} zooms, "
                    f"{len(dec.transiciones)} transiciones. {dec.resumen}")
        return p

    if s["texts"] or s["emojis"] or s["smoothZooms"] or s["transitions"] or s["retakes"]:
        step("Decisiones creativas (Claude)", do_creative, 0.2, 0.55)

    # tomas falsas detectadas por la IA: se borran del final al principio (ripple)
    if removals_out:
        for a, b, why in sorted(removals_out, reverse=True):
            p = ops.ripple_delete(p, a, b, why)
            done.append(f"Quitado por la IA ({why}) en {fmt_time(a)}")
        if s["subtitles"]:
            p["captions"]["blocks"] = build_captions(ops.output_words(p), p["captions"]["style"]["maxWords"])

    # ------------------------------------------------ 4. punch-in alternos en los cortes
    def do_punch(prog):
        spans = ops.segment_spans(p)
        n = 0
        for i, (seg, a, b) in enumerate(spans):
            if i % 2 == 1 and b - a > 0.3:
                mid_src = (seg["inPoint"] + seg["outPoint"]) / 2
                fc = face_center(p, seg["sourceId"], mid_src) or (0.5, 0.42)
                scale = round(1 + (s["punchInScale"] - 1) * (0.6 + 0.8 * s["intensity"]), 3)
                p["zooms"].append({"id": new_id("zoom"), "start": round(a, 3), "end": round(b, 3), "kind": "punch",
                                   "scale": min(scale, 2.0), "x": round(fc[0], 3), "y": round(fc[1], 3)})
                n += 1
        done.append(f"Punch-in: {n} cortes con zoom alterno")
        return p

    if s["punchIns"]:
        step("Zooms en los cortes", do_punch, 0.55, 0.6)

    # ------------------------------------------------ 5. audio
    def do_audio(prog):
        n = len(p["sources"])
        for i, src in enumerate(p["sources"]):
            src["audio"] = audio.process_source_audio(proj_dir, src, s["normalizeAudio"], s["denoise"], job.cancel_event,
                                                      p.get("previewCodec", "h264"))
            prog((i + 1) / n)
        p["audio"]["normalize"], p["audio"]["denoise"] = s["normalizeAudio"], s["denoise"]
        p["audio"]["speech"] = audio.speech_ranges(ops.output_words(p))
        if s.get("music"):
            if (ASSETS_DIR / "music" / s["music"]).exists():
                p["audio"]["music"] = {"file": s["music"], "volume": s["musicVolume"], "ducking": True,
                                       "duckVolume": round(s["musicVolume"] * 0.3, 3), "start": 0.0, "end": None,
                                       "fadeIn": 1.0, "fadeOut": 2.0}
                done.append(f"Música: {s['music']} con ducking automático")
            else:
                warnings.append(f"No se encuentra la música {s['music']} en /assets/music")
        if s["sfx"]:
            f = pick_sfx("transicion")
            g = pick_sfx("texto")
            if not f:
                warnings.append("Efectos de sonido activados pero /assets/sfx está vacío")
            else:
                for tr in p["transitions"]:
                    p["audio"]["sfx"].append({"id": new_id("sfx"), "file": f, "at": max(0, round(tr["at"] - 0.2, 3)), "volume": 0.5})
                for t in p["texts"]:
                    p["audio"]["sfx"].append({"id": new_id("sfx"), "file": g, "at": t["start"], "volume": 0.4})
        done.append("Audio: " + ", ".join(x for x, on in (("volumen normalizado", s["normalizeAudio"]),
                                                          ("ruido de fondo reducido", s["denoise"])) if on) or "sin procesar")
        return p

    step("Procesando audio", do_audio, 0.6, 0.75)

    # ------------------------------------------------ 6. color
    def do_color(prog):
        nonlocal p
        p["color"]["analyzed"] = False
        p2 = color.build_and_apply(proj_dir, p, job, force_analyze=True)
        done.append("Color: " + p2["color"]["message"])
        return p2

    if s["color"]:
        step("Analizando color e iluminación", do_color, 0.75, 1.0)

    p["warnings"] = warnings
    job.warnings = warnings
    return p, {"done": done, "warnings": warnings}
