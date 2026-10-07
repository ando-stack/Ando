"""Fase 6: chat de edición. Claude recibe un resumen del proyecto y modifica project.json con
herramientas. Cada cambio se valida contra el esquema antes de aplicarse; si lo dejaría
inválido, se rechaza y se le explica a Claude (y al usuario) por qué."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable, Optional

import ai_editor
import audio
import faces
import project_ops as ops
import schema
from config import ANTHROPIC_MODEL, ASSETS_DIR
from utils import fmt_time, new_id, now_iso

MAX_TURNS = 12

SYSTEM = """Eres el asistente de edición de un editor de vídeo. El usuario te pide cambios en lenguaje
natural y tú los aplicas con las herramientas, que modifican el proyecto (project.json).

Reglas:
- Los tiempos son segundos del VÍDEO FINAL. "1:20" = 80 s. Si el usuario cita lo que se dice
  ("cuando digo 'bienvenidos'"), usa la transcripción del estado o la herramienta buscar_frase.
- Si la petición es ambigua (p. ej. "quita eso", "cámbialo" sin saber a qué elemento se refiere, o
  hay varios candidatos igual de probables), NO adivines y NO uses herramientas: pregunta en una
  frase a qué elemento se refiere, ofreciendo las opciones concretas (con su tiempo).
- Usa los ids exactos del estado. No inventes ids.
- Si una herramienta devuelve error, corrige la llamada o explica el problema al usuario.
- El pixelado de caras SOLO se aplica si el usuario lo pide explícitamente.
- Al terminar, responde en español, breve, resumiendo lo que has cambiado con el tiempo en mm:ss
  (por ejemplo: "He eliminado el emoji 🔥 en 00:12").
- Posiciones x, y de 0 a 1 (0,0 = arriba a la izquierda). Tamaños de letra relativos a la altura
  (0.05 = normal, 0.08 = grande).
"""


# ====================================================================== resumen del estado
def project_summary(p: dict, max_phrases: int = 400) -> str:
    total = ops.duration(p)
    lines = [f"Duración: {total:.2f} s ({fmt_time(total)}). Lienzo {p['canvas']['width']}x{p['canvas']['height']} "
             f"({p['canvas']['aspect']}). Segmentos de vídeo: {len(p['segments'])}."]
    cuts = [b for _s, _a, b in ops.segment_spans(p)[:-1]]
    lines.append("Cortes (s): " + (", ".join(f"{c:.2f}" for c in cuts) or "ninguno"))
    lines.append("Pistas: " + ", ".join(f"{k}={'sí' if v['enabled'] else 'no'}" for k, v in p["tracks"].items()))
    st = p["captions"]["style"]
    lines.append(f"Subtítulos: {len(p['captions']['blocks'])} bloques; estilo {json.dumps(st, ensure_ascii=False)}")
    if p["texts"]:
        lines.append("Textos:")
        lines += [f"  {t['id']} [{t['start']:.2f}-{t['end']:.2f}] «{t['text']}» ({t['kind']}, x={t['x']}, y={t['y']}, "
                  f"tamaño={t['style']['fontSize']}, color={t['style']['color']}, anim={t['animation']})" for t in p["texts"]]
    if p["emojis"]:
        lines.append("Emojis:")
        lines += [f"  {e['id']} [{e['start']:.2f}-{e['end']:.2f}] {e['emoji']} (x={e['x']}, y={e['y']}, tamaño={e['size']})"
                  for e in p["emojis"]]
    if p["zooms"]:
        lines.append("Zooms:")
        lines += [f"  {z['id']} [{z['start']:.2f}-{z['end']:.2f}] {z['kind']} x{z['scale']}" for z in p["zooms"]]
    if p["transitions"]:
        lines.append("Transiciones: " + "; ".join(f"{t['id']} en {t['at']:.2f} ({t['type']})" for t in p["transitions"]))
    c = p["color"]
    lines.append(f"Color: activado={c['enabled']}, necesita corrección={c['needsCorrection']}, intensidad={c['intensity']}, "
                 f"temperatura={c['temperature']}, exposición={c['exposure']}, contraste={c['contrast']}, "
                 f"saturación={c['saturation']}. {c.get('message', '')}")
    fc = p["faces"]
    if fc["analyzed"]:
        desc = []
        for tr in fc["tracks"]:
            rng = []
            for part in tr["parts"]:
                if part["samples"]:
                    rng += ops.source_range_to_output(p, part["sourceId"], part["samples"][0]["t"], part["samples"][-1]["t"])
            desc.append(f"{tr['id']} ({tr['label']}, aparece en " + ", ".join(f"{a:.1f}-{b:.1f}" for a, b in rng[:6]) + ")")
        lines.append("Caras detectadas: " + ("; ".join(desc) or "ninguna"))
    else:
        lines.append("Caras: sin analizar (usa analizar_caras si el usuario quiere pixelar).")
    if fc["pixelate"]:
        lines.append("Pixelados: " + "; ".join(f"{x['id']} {x['faceId']} [{x['start']:.2f}-{x['end']:.2f}] {x['mode']} "
                                                 f"intensidad {x['intensity']}" for x in fc["pixelate"]))
    a = p["audio"]
    lines.append(f"Audio: voz x{a['voiceVolume']}, música={json.dumps(a['music'], ensure_ascii=False) if a['music'] else 'ninguna'}, "
                 f"efectos={len(a['sfx'])}. Música disponible: {audio.list_library('music') or 'ninguna'}. "
                 f"Efectos disponibles: {audio.list_library('sfx') or 'ninguno'}.")
    words = ops.output_words(p)
    from cleanup import phrases
    ph = phrases(words)[:max_phrases]
    lines.append("Transcripción (tiempo final):")
    lines += [f"  [{x['start']:.2f}-{x['end']:.2f}] {x['text']}" for x in ph]
    return "\n".join(lines)


# ====================================================================== herramientas
def _obj(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


N = {"type": "number"}
S = {"type": "string"}
B = {"type": "boolean"}
ANIM = {"type": "string", "enum": ["none", "fade", "pop", "slide-up", "slide-left", "typewriter", "bounce"]}

TOOLS = [
    {"name": "buscar_frase", "description": "Busca en qué momento(s) del vídeo final se dice un texto. Devuelve inicio y fin.",
     "input_schema": _obj({"texto": S}, ["texto"])},
    {"name": "anadir_texto", "description": "Añade un texto o título animado en pantalla.",
     "input_schema": _obj({"texto": S, "inicio": N, "fin": N, "tipo": {"type": "string", "enum": ["titulo", "texto", "dato"]},
                           "x": N, "y": N, "animacion": ANIM, "color": S, "tamano": N}, ["texto", "inicio", "fin"])},
    {"name": "anadir_emoji", "description": "Añade un emoji (debe estar en el catálogo) en pantalla.",
     "input_schema": _obj({"emoji": S, "inicio": N, "duracion": N, "x": N, "y": N, "tamano": N, "animacion": ANIM},
                          ["emoji", "inicio"])},
    {"name": "anadir_zoom", "description": "Añade un zoom. tipo 'smooth' = acercamiento suave; 'punch' = salto directo.",
     "input_schema": _obj({"inicio": N, "fin": N, "escala": N, "tipo": {"type": "string", "enum": ["smooth", "punch"]},
                           "x": N, "y": N}, ["inicio", "fin"])},
    {"name": "anadir_transicion", "description": "Añade una transición en un corte (se ajusta al corte más cercano).",
     "input_schema": _obj({"tiempo": N, "tipo": {"type": "string", "enum": ["fade", "flash", "zoom", "whip", "glitch"]},
                           "duracion": N}, ["tiempo"])},
    {"name": "editar_elemento",
     "description": ("Modifica campos de un elemento existente por su id (texto, emoji, zoom, transición, pixelado, efecto de "
                     "sonido o bloque de subtítulo). 'cambios' usa los nombres de campo de project.json, p. ej. "
                     "{\"start\": 3, \"end\": 5, \"text\": \"Hola\", \"x\": 0.5, \"y\": 0.2, \"size\": 0.2, \"emoji\": \"🎉\", "
                     "\"scale\": 1.2, \"type\": \"flash\", \"intensity\": 0.8, \"mode\": \"blur\", \"animation\": \"fade\", "
                     "\"style\": {\"color\": \"#FF0000\", \"fontSize\": 0.09}}. Para un bloque de subtítulo, "
                     "\"text\" reemplaza sus palabras."),
     "input_schema": _obj({"id": S, "cambios": {"type": "object"}}, ["id", "cambios"])},
    {"name": "mover_elemento", "description": "Mueve un elemento en el tiempo manteniendo su duración.",
     "input_schema": _obj({"id": S, "nuevo_inicio": N}, ["id", "nuevo_inicio"])},
    {"name": "eliminar_elementos", "description": "Elimina elementos por id (textos, emojis, zooms, transiciones, pixelados, efectos, subtítulos).",
     "input_schema": _obj({"ids": {"type": "array", "items": S}}, ["ids"])},
    {"name": "estilo_subtitulos",
     "description": ("Cambia el estilo de todos los subtítulos. Campos: preset (clasico, tiktok, neon, minimal, karaoke), font "
                     "(Montserrat, Anton, BebasNeue, Poppins, Inter), fontSize (0.03-0.2), color, highlightColor, strokeColor, "
                     "background (bool), backgroundColor, y (0-1), uppercase (bool), maxWords (1-12)."),
     "input_schema": _obj({"cambios": {"type": "object"}}, ["cambios"])},
    {"name": "eliminar_tramo", "description": "Recorta (elimina) un tramo del vídeo final; todo lo posterior se adelanta.",
     "input_schema": _obj({"inicio": N, "fin": N}, ["inicio", "fin"])},
    {"name": "ajustar_color",
     "description": ("Ajusta la corrección de color. Valores de -1 a 1 (0 = sin cambio) para temperatura (+ = más cálido), "
                     "exposicion, contraste y saturacion; intensidad del LUT de 0 a 1; activado true/false. "
                     "Los valores son absolutos, no incrementos."),
     "input_schema": _obj({"activado": B, "intensidad": N, "temperatura": N, "exposicion": N, "contraste": N, "saturacion": N}, [])},
    {"name": "analizar_caras", "description": "Detecta y sigue las caras del vídeo (necesario antes de pixelar).",
     "input_schema": _obj({}, [])},
    {"name": "pixelar_cara",
     "description": "Pixela (o desenfoca) una cara detectada o todas. Solo si el usuario lo pide. inicio/fin opcionales limitan el tramo.",
     "input_schema": _obj({"cara": S, "modo": {"type": "string", "enum": ["pixelate", "blur"]}, "intensidad": N,
                           "margen": N, "inicio": N, "fin": N}, ["cara"])},
    {"name": "despixelar", "description": "Quita el pixelado de una cara (id de cara) o de todas ('todas').",
     "input_schema": _obj({"cara": S}, ["cara"])},
    {"name": "musica", "description": "Pone, cambia o quita (archivo vacío) la música de fondo y su volumen (0-1.5).",
     "input_schema": _obj({"archivo": S, "volumen": N, "ducking": B}, [])},
    {"name": "volumen_voz", "description": "Volumen general de la voz (1 = normal, 0-4).",
     "input_schema": _obj({"volumen": N}, ["volumen"])},
    {"name": "anadir_efecto_sonido", "description": "Añade un efecto de sonido de /assets/sfx en un instante.",
     "input_schema": _obj({"archivo": S, "tiempo": N, "volumen": N}, ["archivo", "tiempo"])},
    {"name": "activar_pista", "description": "Activa o desactiva una pista completa (video, subtitulos, textos, emojis, zooms, transiciones, color, pixelado, musica, sfx).",
     "input_schema": _obj({"pista": S, "activa": B}, ["pista", "activa"])},
]

COLLECTIONS = [("texts", "texto"), ("emojis", "emoji"), ("zooms", "zoom"), ("transitions", "transición")]


class ToolError(Exception):
    pass


def _find(p: dict, item_id: str) -> tuple[list, dict, str]:
    for key, label in COLLECTIONS:
        for it in p[key]:
            if it["id"] == item_id:
                return p[key], it, label
    for it in p["faces"]["pixelate"]:
        if it["id"] == item_id:
            return p["faces"]["pixelate"], it, "pixelado"
    for it in p["audio"]["sfx"]:
        if it["id"] == item_id:
            return p["audio"]["sfx"], it, "efecto de sonido"
    for it in p["captions"]["blocks"]:
        if it["id"] == item_id:
            return p["captions"]["blocks"], it, "subtítulo"
    raise ToolError(f"No existe ningún elemento con id '{item_id}'")


def _describe(it: dict, label: str) -> str:
    t = it.get("start", it.get("at", 0))
    what = it.get("text") or it.get("emoji") or it.get("type") or it.get("kind") or it.get("file") or ""
    if "words" in it:
        what = " ".join(w["text"] for w in it["words"])
    return f"{label} {what} en {fmt_time(t)}".replace("  ", " ")


def _deep_merge(dst: dict, src: dict):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], v)
        else:
            dst[k] = v


class Session:
    """Aplica herramientas sobre una copia del proyecto. Lleva la lista de cambios y si hay que
    regenerar el color (LUT) al terminar."""

    def __init__(self, proj_dir: Path, p: dict):
        self.dir = proj_dir
        self.p = p
        self.changes: list[str] = []
        self.needs_color = False

    def run(self, name: str, args: dict) -> str:
        fn: Callable = getattr(self, "t_" + name, None)
        if fn is None:
            raise ToolError(f"Herramienta desconocida: {name}")
        before = copy.deepcopy(self.p)
        n_changes = len(self.changes)
        try:
            result = fn(**args)
            schema.validate(self.p)        # nunca dejar el proyecto inválido
            return result
        except schema.ProjectInvalid as e:
            self.p = before
            del self.changes[n_changes:]
            raise ToolError(f"Cambio rechazado porque dejaría el proyecto inválido: {e}")
        except TypeError as e:
            self.p = before
            del self.changes[n_changes:]
            raise ToolError(f"Parámetros incorrectos: {e}")
        except ToolError:
            self.p = before
            del self.changes[n_changes:]
            raise

    # ------------------------------------------------------------- consultas
    def t_buscar_frase(self, texto: str) -> str:
        hits = ops.find_phrase(self.p, texto)
        if not hits:
            return f"No se encontró «{texto}» en la transcripción."
        return json.dumps(hits[:10], ensure_ascii=False)

    # ------------------------------------------------------------- añadir
    def t_anadir_texto(self, texto, inicio, fin, tipo="texto", x=None, y=None, animacion=None, color=None, tamano=None) -> str:
        from autoedit import TEXT_POS, TEXT_STYLES
        style = dict(TEXT_STYLES.get(tipo, TEXT_STYLES["texto"]))
        if color:
            style["color"] = color
        if tamano:
            style["fontSize"] = tamano
        dx, dy = TEXT_POS.get(tipo, (0.5, 0.2))
        it = {"id": new_id("txt"), "start": round(inicio, 3), "end": round(fin, 3), "text": texto, "kind": tipo,
              "x": dx if x is None else x, "y": dy if y is None else y,
              "animation": animacion or "pop", "style": style}
        self.p["texts"].append(it)
        self.changes.append(f"He añadido el texto «{texto}» en {fmt_time(inicio)}")
        return f"ok, id={it['id']}"

    def t_anadir_emoji(self, emoji, inicio, duracion=1.5, x=0.8, y=0.3, tamano=0.14, animacion="pop") -> str:
        cat = {e["emoji"]: e["file"] for e in ai_editor.emoji_catalog()}
        if emoji not in cat:
            alt = emoji.replace("️", "")
            match = next((k for k in cat if k.replace("️", "") == alt), None)
            if not match:
                raise ToolError(f"El emoji {emoji} no está en el catálogo. Disponibles: {' '.join(cat)}")
            emoji = match
        it = {"id": new_id("emo"), "start": round(inicio, 3), "end": round(inicio + duracion, 3), "emoji": emoji,
              "file": cat[emoji], "x": x, "y": y, "size": tamano, "rotation": 0, "animation": animacion}
        self.p["emojis"].append(it)
        self.changes.append(f"He añadido el emoji {emoji} en {fmt_time(inicio)}")
        return f"ok, id={it['id']}"

    def t_anadir_zoom(self, inicio, fin, escala=1.2, tipo="smooth", x=0.5, y=0.42) -> str:
        it = {"id": new_id("zoom"), "start": round(inicio, 3), "end": round(fin, 3), "kind": tipo, "scale": escala, "x": x, "y": y}
        self.p["zooms"].append(it)
        self.changes.append(f"He añadido un zoom x{escala} de {fmt_time(inicio)} a {fmt_time(fin)}")
        return f"ok, id={it['id']}"

    def t_anadir_transicion(self, tiempo, tipo="fade", duracion=0.4) -> str:
        cuts = [b for _s, _a, b in ops.segment_spans(self.p)[:-1]]
        if not cuts:
            raise ToolError("El vídeo no tiene cortes donde poner una transición")
        at = min(cuts, key=lambda c: abs(c - tiempo))
        if abs(at - tiempo) > 3:
            raise ToolError(f"No hay ningún corte cerca de {fmt_time(tiempo)}. Cortes: {', '.join(fmt_time(c) for c in cuts[:30])}")
        it = {"id": new_id("trans"), "at": round(at, 3), "duration": duracion, "type": tipo}
        self.p["transitions"].append(it)
        self.changes.append(f"He añadido una transición {tipo} en {fmt_time(at)}")
        return f"ok, id={it['id']} en {at:.2f}"

    # ------------------------------------------------------------- editar
    def t_editar_elemento(self, id, cambios: dict) -> str:  # noqa: A002
        coll, it, label = _find(self.p, id)
        cambios = dict(cambios)
        if "words" in it and "text" in cambios:
            text = str(cambios.pop("text")).split()
            if not text:
                raise ToolError("El texto del subtítulo no puede estar vacío")
            a, b = it["start"], it["end"]
            step = (b - a) / len(text)
            it["words"] = [{"text": w, "start": round(a + i * step, 3), "end": round(a + (i + 1) * step, 3)}
                           for i, w in enumerate(text)]
        if "emoji" in cambios:
            cat = {e["emoji"]: e["file"] for e in ai_editor.emoji_catalog()}
            if cambios["emoji"] not in cat:
                raise ToolError(f"El emoji {cambios['emoji']} no está en el catálogo")
            cambios["file"] = cat[cambios["emoji"]]
        if "id" in cambios:
            raise ToolError("No se puede cambiar el id")
        _deep_merge(it, cambios)
        self.changes.append(f"He modificado el {_describe(it, label)}")
        return "ok"

    def t_mover_elemento(self, id, nuevo_inicio) -> str:  # noqa: A002
        _coll, it, label = _find(self.p, id)
        if "at" in it:
            it["at"] = round(nuevo_inicio, 3)
        else:
            d = it["end"] - it["start"]
            it["start"], it["end"] = round(nuevo_inicio, 3), round(nuevo_inicio + d, 3)
            if "words" in it:
                raise ToolError("Los subtítulos van sincronizados con la voz y no se mueven; edita su texto o estilo")
        self.changes.append(f"He movido el {_describe(it, label)}")
        return "ok"

    def t_eliminar_elementos(self, ids: list[str]) -> str:
        for i in ids:
            coll, it, label = _find(self.p, i)
            coll.remove(it)
            self.changes.append(f"He eliminado el {_describe(it, label)}")
        return "ok"

    def t_estilo_subtitulos(self, cambios: dict) -> str:
        st = self.p["captions"]["style"]
        old_max = st["maxWords"]
        _deep_merge(st, cambios)
        if st["maxWords"] != old_max:
            from autoedit import build_captions
            self.p["captions"]["blocks"] = build_captions(ops.output_words(self.p), st["maxWords"])
        self.changes.append("He cambiado el estilo de los subtítulos (" + ", ".join(f"{k}={v}" for k, v in cambios.items()) + ")")
        return "ok"

    def t_eliminar_tramo(self, inicio, fin) -> str:
        if fin <= inicio:
            raise ToolError("'fin' debe ser mayor que 'inicio'")
        total = ops.duration(self.p)
        if inicio >= total:
            raise ToolError(f"El vídeo dura {total:.2f} s")
        self.p = ops.ripple_delete(self.p, inicio, fin, "recorte desde el chat")
        self.changes.append(f"He eliminado el tramo de {fmt_time(inicio)} a {fmt_time(min(fin, total))}")
        return f"ok, nueva duración {ops.duration(self.p):.2f} s"

    # ------------------------------------------------------------- color
    def t_ajustar_color(self, activado=None, intensidad=None, temperatura=None, exposicion=None, contraste=None, saturacion=None) -> str:
        c = self.p["color"]
        mapping = {"intensity": intensidad, "temperature": temperatura, "exposure": exposicion,
                   "contrast": contraste, "saturation": saturacion}
        parts = []
        for k, v in mapping.items():
            if v is not None:
                c[k] = float(v)
                parts.append(f"{k}={v:+.2f}" if k != "intensity" else f"intensidad={v:.2f}")
        if activado is not None:
            c["enabled"] = bool(activado)
            parts.append("activado" if activado else "desactivado")
        elif parts:
            c["enabled"] = True
        self.p["tracks"]["color"]["enabled"] = c["enabled"] or self.p["tracks"]["color"]["enabled"]
        self.needs_color = True
        self.changes.append("He ajustado el color (" + ", ".join(parts) + ")")
        return "ok (el LUT se regenerará al terminar)"

    # ------------------------------------------------------------- caras
    def t_analizar_caras(self) -> str:
        self.p = faces.analyze_project(self.dir, self.p)
        tr = self.p["faces"]["tracks"]
        self.changes.append(f"He analizado las caras: {len(tr)} persona(s) detectada(s)")
        return json.dumps([{"id": t["id"], "label": t["label"]} for t in tr], ensure_ascii=False)

    def t_pixelar_cara(self, cara, modo="pixelate", intensidad=0.75, margen=0.35, inicio=None, fin=None) -> str:
        if not self.p["faces"]["analyzed"]:
            self.t_analizar_caras()
        ids = [t["id"] for t in self.p["faces"]["tracks"]] if cara in ("todas", "all", "*") else [cara]
        if not ids:
            raise ToolError("No se ha detectado ninguna cara en el vídeo")
        added = 0
        for fid in ids:
            items = faces.default_pixelate_items(self.p, fid, modo, intensidad, margen)
            if not items and fid not in {t["id"] for t in self.p["faces"]["tracks"]}:
                raise ToolError(f"No existe la cara '{fid}'")
            for it in items:
                if inicio is not None:
                    it["start"] = max(it["start"], inicio)
                if fin is not None:
                    it["end"] = min(it["end"], fin)
                if it["end"] - it["start"] >= 0.05:
                    self.p["faces"]["pixelate"] = [x for x in self.p["faces"]["pixelate"]
                                                   if not (x["faceId"] == fid and x["start"] < it["end"] and x["end"] > it["start"])]
                    self.p["faces"]["pixelate"].append(it)
                    added += 1
        self.p["tracks"]["pixelado"]["enabled"] = True
        self.changes.append(f"He {'pixelado' if modo == 'pixelate' else 'desenfocado'} {'todas las caras' if len(ids) > 1 else ids[0]} "
                            f"({added} tramo(s))")
        return f"ok, {added} tramos"

    def t_despixelar(self, cara) -> str:
        before = len(self.p["faces"]["pixelate"])
        self.p["faces"]["pixelate"] = [] if cara in ("todas", "all", "*") else \
            [x for x in self.p["faces"]["pixelate"] if x["faceId"] != cara]
        n = before - len(self.p["faces"]["pixelate"])
        if not n:
            raise ToolError("No había pixelado para esa cara")
        self.changes.append(f"He quitado el pixelado de {'todas las caras' if cara in ('todas', 'all', '*') else cara}")
        return "ok"

    # ------------------------------------------------------------- audio
    def t_musica(self, archivo=None, volumen=None, ducking=None) -> str:
        a = self.p["audio"]
        if archivo == "":
            a["music"] = None
            self.changes.append("He quitado la música de fondo")
            return "ok"
        if archivo:
            if archivo not in audio.list_library("music"):
                raise ToolError(f"No existe {archivo} en /assets/music. Disponibles: {audio.list_library('music') or 'ninguno'}")
            a["music"] = {**(a["music"] or {"volume": 0.25, "ducking": True, "duckVolume": 0.08, "start": 0, "end": None,
                                            "fadeIn": 1.0, "fadeOut": 2.0}), "file": archivo}
        if a["music"] is None:
            raise ToolError("No hay música puesta; indica un archivo")
        if volumen is not None:
            a["music"]["volume"] = float(volumen)
            a["music"]["duckVolume"] = round(float(volumen) * 0.3, 3)
        if ducking is not None:
            a["music"]["ducking"] = bool(ducking)
        self.changes.append(f"He ajustado la música ({a['music']['file']}, volumen {a['music']['volume']:.2f})")
        return "ok"

    def t_volumen_voz(self, volumen) -> str:
        self.p["audio"]["voiceVolume"] = float(volumen)
        self.changes.append(f"He puesto el volumen de la voz a {volumen:.2f}")
        return "ok"

    def t_anadir_efecto_sonido(self, archivo, tiempo, volumen=0.6) -> str:
        if archivo not in audio.list_library("sfx"):
            raise ToolError(f"No existe {archivo} en /assets/sfx. Disponibles: {audio.list_library('sfx') or 'ninguno'}")
        it = {"id": new_id("sfx"), "file": archivo, "at": round(tiempo, 3), "volume": volumen}
        self.p["audio"]["sfx"].append(it)
        self.changes.append(f"He añadido el efecto {archivo} en {fmt_time(tiempo)}")
        return f"ok, id={it['id']}"

    def t_activar_pista(self, pista, activa) -> str:
        if pista not in self.p["tracks"]:
            raise ToolError(f"Pista desconocida: {pista}")
        self.p["tracks"][pista]["enabled"] = bool(activa)
        self.changes.append(f"He {'activado' if activa else 'desactivado'} la pista {pista}")
        return "ok"


# ====================================================================== bucle de conversación
def history_messages(p: dict, limit: int = 20) -> list[dict]:
    msgs = []
    for m in p.get("chat", [])[-limit:]:
        if m["role"] in ("user", "assistant") and m["content"].strip():
            msgs.append({"role": m["role"], "content": m["content"]})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    # la API exige alternancia; se fusionan mensajes seguidos del mismo rol
    merged: list[dict] = []
    for m in msgs:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n" + m["content"]
        else:
            merged.append(dict(m))
    return merged


def run_chat(proj_dir: Path, p: dict, message: str, create: Optional[Callable[..., Any]] = None) -> dict:
    """Ejecuta una petición del chat. `create` permite inyectar un cliente simulado en las pruebas.
    Devuelve {project, reply, changes, needsColor}."""
    create = create or ai_editor.create_message
    sess = Session(proj_dir, copy.deepcopy(p))
    history = history_messages(p)
    user_content = f"<estado_proyecto>\n{project_summary(p)}\n</estado_proyecto>\n\nPetición del usuario: {message}"
    messages = history + [{"role": "user", "content": user_content}]
    if len(messages) >= 2 and messages[-2]["role"] == "user":  # no debería pasar, pero por seguridad
        messages[-2:] = [{"role": "user", "content": messages[-2]["content"] + "\n\n" + user_content}]
    reply = ""
    for _turn in range(MAX_TURNS):
        resp = create(model=ANTHROPIC_MODEL, max_tokens=16000, system=SYSTEM, tools=TOOLS,
                      output_config={"effort": "medium"}, messages=messages)
        if resp.stop_reason == "refusal":
            reply = "No puedo hacer ese cambio."
            break
        texts = [b.text for b in resp.content if b.type == "text"]
        uses = [b for b in resp.content if b.type == "tool_use"]
        if texts:
            reply = "\n".join(texts).strip()
        if resp.stop_reason != "tool_use" or not uses:
            break
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for u in uses:
            try:
                out = sess.run(u.name, dict(u.input or {}))
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
            except ToolError as e:
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": f"Error: {e}", "is_error": True})
            except Exception as e:  # noqa: BLE001
                results.append({"type": "tool_result", "tool_use_id": u.id, "content": f"Error interno: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})
    else:
        reply = reply or "He alcanzado el máximo de pasos para esta petición."
    if not reply:
        reply = "\n".join(sess.changes) or "Hecho."
    out = sess.p
    out.setdefault("chat", [])
    out["chat"].append({"role": "user", "content": message, "time": now_iso(), "changes": [], "pending": False})
    out["chat"].append({"role": "assistant", "content": reply, "time": now_iso(), "changes": sess.changes, "pending": False})
    return {"project": out, "reply": reply, "changes": sess.changes, "needsColor": sess.needs_color}
