"""Simulador de Claude SOLO PARA PRUEBAS (sin clave de API ni red).

Se activa con la variable de entorno EDITOR_FAKE_AI=1. Responde con reglas fijas a un conjunto
de peticiones de ejemplo, devolviendo las mismas estructuras (bloques text / tool_use, JSON de
decisiones) que la API real, para probar de punta a punta la ejecución de herramientas, la
validación, el deshacer y la interfaz. No sustituye a Claude: no entiende lenguaje natural.

EDITOR_FAKE_AI=invalid  -> las decisiones creativas devuelven JSON no válido (prueba de reintento).
"""
from __future__ import annotations

import json
import os
import re
from types import SimpleNamespace as NS

_n = 0


def _id():
    global _n
    _n += 1
    return f"toolu_fake_{_n}"


def text(t):
    return NS(type="text", text=t)


def tool(name, **inp):
    return NS(type="tool_use", id=_id(), name=name, input=inp)


def resp(*blocks, stop=None):
    stop = stop or ("tool_use" if any(b.type == "tool_use" for b in blocks) else "end_turn")
    return NS(content=list(blocks), stop_reason=stop, stop_details=None)


def _content_text(c):
    if isinstance(c, str):
        return c
    out = []
    for b in c:
        if isinstance(b, dict):
            out.append(str(b.get("content", "")) if b.get("type") == "tool_result" else b.get("text", ""))
        elif getattr(b, "type", "") == "text":
            out.append(b.text)
    return "\n".join(out)


def _last_request(messages):
    for m in reversed(messages):
        if m["role"] == "user" and isinstance(m["content"], str) and "Petición del usuario:" in m["content"]:
            est, req = m["content"].split("Petición del usuario:", 1)
            return est, req.strip()
    return "", ""


def _mmss(m, s):
    return int(m) * 60 + float(s)


# ====================================================================== chat
def chat_turn(messages):
    estado, req = _last_request(messages)
    low = req.lower()
    last = messages[-1]
    if isinstance(last["content"], list):  # resultados de herramientas
        results = [b for b in last["content"] if isinstance(b, dict) and b.get("type") == "tool_result"]
        errors = [r["content"] for r in results if r.get("is_error")]
        if errors:
            return resp(text("No he podido hacer el cambio: " + "; ".join(str(e) for e in errors)))
        # segundo paso del título "cuando digo ..."
        m = re.search(r'añade un título "(.+?)" cuando digo "(.+?)"', req, re.I)
        prev_tools = [b for b in messages[-2]["content"] if getattr(b, "type", "") == "tool_use"]
        if m and prev_tools and prev_tools[0].name == "buscar_frase":
            try:
                hits = json.loads(results[0]["content"])
                t0 = float(hits[0]["start"])
            except (ValueError, KeyError, IndexError, TypeError):
                return resp(text(f"No encuentro «{m.group(2)}» en el vídeo."))
            return resp(tool("anadir_texto", texto=m.group(1), inicio=t0, fin=t0 + 2.5, tipo="titulo"))
        return resp(text("Hecho. " + " ".join(str(r["content"]) for r in results)[:200]))

    if re.fullmatch(r"(quita|borra|cambia) (eso|esto)\.?", low):
        items = re.findall(r"^\s+((?:emo|txt|zoom)-\w+) \[([\d.]+)-", estado, re.M)
        opts = ", ".join(f"{i} ({float(t):.1f} s)" for i, t in items[:5]) or "ningún elemento"
        return resp(text(f"¿A qué elemento te refieres? Puedo quitar: {opts}. Dime cuál (por ejemplo por su tiempo)."))
    m = re.search(r"quita el emoji del segundo (\d+(?:\.\d+)?)", low)
    if m:
        t = float(m.group(1))
        cands = [(abs((float(a) + float(b)) / 2 - t), i) for i, a, b in re.findall(r"^\s+(emo-\w+) \[([\d.]+)-([\d.]+)\]", estado, re.M)]
        cands = [c for c in cands if c[0] < 2.5]
        if not cands:
            return resp(text(f"No hay ningún emoji cerca del segundo {t:g}."))
        return resp(tool("eliminar_elementos", ids=[min(cands)[1]]))
    if "subtítulos más grandes" in low:
        size = float(re.search(r'"fontSize": ([\d.]+)', estado).group(1))
        return resp(tool("estilo_subtitulos", cambios={"fontSize": round(size * 1.3, 3)}))
    if "más cálida" in low:
        cur = float(re.search(r"temperatura=(-?[\d.]+)", estado).group(1))
        return resp(tool("ajustar_color", temperatura=min(1.0, cur + 0.35)))
    m = re.search(r'añade un título "(.+?)" cuando digo "(.+?)"', req, re.I)
    if m:
        return resp(tool("buscar_frase", texto=m.group(2)))
    m = re.search(r"recorta del (\d+):(\d+) al (\d+):(\d+)", low)
    if m:
        return resp(tool("eliminar_tramo", inicio=_mmss(*m.group(1, 2)), fin=_mmss(*m.group(3, 4))))
    m = re.search(r"mueve el texto «(.+?)» al segundo (\d+(?:\.\d+)?)", req, re.I)
    if m:
        hit = re.search(r"^\s+(txt-\w+) \[[^\]]+\] «" + re.escape(m.group(1)) + "»", estado, re.M)
        if not hit:
            return resp(text(f"No encuentro el texto «{m.group(1)}»."))
        return resp(tool("mover_elemento", id=hit.group(1), nuevo_inicio=float(m.group(2))))
    m = re.search(r"zoom suave en el segundo (\d+(?:\.\d+)?)", low)
    if m:
        t = float(m.group(1))
        return resp(tool("anadir_zoom", inicio=t, fin=t + 3, escala=1.2, tipo="smooth"))
    if re.search(r"pixela (la|las) caras?", low):
        return resp(tool("pixelar_cara", cara="todas", modo="blur" if "desenfoc" in low else "pixelate"))
    if "quita el pixelado" in low:
        return resp(tool("despixelar", cara="todas"))
    m = re.search(r"transición (\w+) en el (primer|segundo|tercer) corte", low)
    if m:
        cuts = [float(x) for x in re.search(r"Cortes \(s\): ([\d., ]+)", estado).group(1).split(", ")]
        idx = {"primer": 0, "segundo": 1, "tercer": 2}[m.group(2)]
        tipo = {"destello": "flash", "flash": "flash", "fundido": "fade", "zoom": "zoom", "barrido": "whip", "glitch": "glitch"}.get(m.group(1), "fade")
        return resp(tool("anadir_transicion", tiempo=cuts[idx], tipo=tipo))
    m = re.search(r"pon el texto «(.+?)» en el segundo (\d+(?:\.\d+)?)", req, re.I)
    if m:
        t = float(m.group(2))
        return resp(tool("anadir_texto", texto=m.group(1), inicio=t, fin=t + 2))
    m = re.search(r"pon un emoji (\S+) en el (\d+):(\d+)", req, re.I)
    if m:
        return resp(tool("anadir_emoji", emoji=m.group(1), inicio=_mmss(m.group(2), m.group(3))))
    m = re.search(r"voz (?:al|a) ([\d.,]+)", low)
    if m:
        return resp(tool("volumen_voz", volumen=float(m.group(1).replace(",", "."))))
    m = re.search(r"desactiva (?:la pista de )?(?:los )?(subtitulos|subtítulos|emojis|textos|zooms)", low)
    if m:
        return resp(tool("activar_pista", pista=m.group(1).replace("í", "i"), activa=False))
    return resp(text("(Simulador de pruebas) No reconozco esta petición."))


# ====================================================================== decisiones creativas
def creative(prompt: str):
    if os.getenv("EDITOR_FAKE_AI") == "invalid":
        return resp(text('{"titulos": [ {"inicio": "mal" '))
    phrases = [(float(a), float(b), t) for a, b, t in re.findall(r"^\[([\d.]+)-([\d.]+)\] (.+)$", prompt, re.M)]
    cuts = [float(x) for x in re.search(r"Cortes existentes \(s\): ([^\n]+)", prompt).group(1).split(", ") if x[0].isdigit()]
    dec = {"quitar": [], "titulos": [], "emojis": [], "zooms": [], "transiciones": [], "resumen": "Edición dinámica (simulada)."}
    rules = [("bienvenid", "👋"), ("gratis", "🆓"), ("automátic", "🤖"), ("gustado", "❤️"), ("inteligencia", "🧠"), ("fácil", "💪")]
    for a, b, t in phrases:
        lt = t.lower()
        if "bienvenid" in lt and not dec["titulos"]:
            dec["titulos"].append({"inicio": a, "fin": a + 2.5, "texto": "¡Bienvenidos!", "tipo": "titulo"})
        if "gratis" in lt:
            dec["titulos"].append({"inicio": a, "fin": b + 1, "texto": "100 % gratis", "tipo": "dato"})
        for k, e in rules:
            if k in lt:
                dec["emojis"].append({"tiempo": a + 0.2, "duracion": 1.6, "emoji": e, "motivo": k})
                break
        if "fácil" in lt or "inteligencia" in lt:
            dec["zooms"].append({"inicio": a, "fin": b, "escala": 1.15})
    if len(cuts) >= 2:
        dec["transiciones"] = [{"tiempo": cuts[1], "tipo": "flash"}, {"tiempo": cuts[-1], "tipo": "fade"}]
    return resp(text(json.dumps(dec, ensure_ascii=False)))


def create(**kwargs):
    messages = kwargs["messages"]
    if kwargs.get("tools"):
        return chat_turn(messages)
    prompt = _content_text(messages[0]["content"])
    if "continúa directamente" in prompt:
        items = json.loads(prompt[prompt.index("["):])
        return resp(text(json.dumps({"pares": [{"par": it["par"], "continuidad": 0.5} for it in items]})))
    if len(messages) > 1:  # reintento tras JSON no válido
        return resp(text(json.dumps({"quitar": [], "titulos": [], "emojis": [], "zooms": [], "transiciones": [],
                                     "resumen": "corregido"})) if os.getenv("EDITOR_FAKE_AI") != "invalid"
                    else text("sigue sin ser json"))
    return creative(prompt)
