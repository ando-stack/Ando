"""Decisiones creativas con Claude. Solo se envía TEXTO (transcripción y datos del proyecto),
nunca vídeo ni imágenes. La respuesta es un JSON validado contra un esquema; si no es válido
se reintenta una vez y, si vuelve a fallar, se aplican solo los pasos automáticos."""
from __future__ import annotations

import json
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from config import ANTHROPIC_MODEL, ASSETS_DIR, ai_available

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AIUnavailable(RuntimeError):
    pass


def client():
    if not ai_available():
        raise AIUnavailable("No hay clave de API de Anthropic (ANTHROPIC_API_KEY en .env)")
    import anthropic
    return anthropic.Anthropic()


def create_message(**kwargs):
    """Llamada a la API con el respaldo de modelo del servidor (si un modelo rechaza la
    petición, la API la reintenta con otro). Si la cuenta no admite la beta, se repite sin ella."""
    import os
    if os.getenv("EDITOR_FAKE_AI"):  # solo para pruebas automáticas
        from tests import fake_claude
        return fake_claude.create(**kwargs)
    import anthropic
    c = client()
    try:
        return c.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
    except anthropic.BadRequestError as e:
        if "fallback" not in str(e).lower():
            raise
        return c.messages.create(**kwargs)


def text_of(resp) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


def emoji_catalog() -> list[dict]:
    f = ASSETS_DIR / "emojis" / "index.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


# ====================================================================== esquema de decisiones
class Titulo(BaseModel):
    inicio: float = Field(ge=0)
    fin: float = Field(gt=0)
    texto: str = Field(min_length=1, max_length=80)
    tipo: Literal["titulo", "texto", "dato"] = "texto"


class EmojiDec(BaseModel):
    tiempo: float = Field(ge=0)
    duracion: float = Field(default=1.5, gt=0.3, le=4)
    emoji: str
    motivo: str = ""


class ZoomDec(BaseModel):
    inicio: float = Field(ge=0)
    fin: float = Field(gt=0)
    escala: float = Field(default=1.15, ge=1.03, le=1.5)


class TransDec(BaseModel):
    tiempo: float = Field(ge=0)
    tipo: Literal["fade", "flash", "zoom", "whip", "glitch"] = "fade"


class QuitarDec(BaseModel):
    inicio: float = Field(ge=0)
    fin: float = Field(gt=0)
    motivo: Literal["toma falsa", "repeticion", "muletilla", "error"] = "toma falsa"


class Decisiones(BaseModel):
    quitar: list[QuitarDec] = []
    titulos: list[Titulo] = []
    emojis: list[EmojiDec] = []
    zooms: list[ZoomDec] = []
    transiciones: list[TransDec] = []
    resumen: str = ""


def _json_schema() -> dict:
    """Esquema estricto para output_config.format (sin restricciones numéricas: se validan después)."""
    def obj(props: dict, req: list[str]):
        return {"type": "object", "properties": props, "required": req, "additionalProperties": False}
    num, s = {"type": "number"}, {"type": "string"}
    return obj({
        "quitar": {"type": "array", "items": obj({"inicio": num, "fin": num, "motivo": {
            "type": "string", "enum": ["toma falsa", "repeticion", "muletilla", "error"]}}, ["inicio", "fin", "motivo"])},
        "titulos": {"type": "array", "items": obj({"inicio": num, "fin": num, "texto": s, "tipo": {
            "type": "string", "enum": ["titulo", "texto", "dato"]}}, ["inicio", "fin", "texto", "tipo"])},
        "emojis": {"type": "array", "items": obj({"tiempo": num, "duracion": num, "emoji": s, "motivo": s},
                                                 ["tiempo", "duracion", "emoji", "motivo"])},
        "zooms": {"type": "array", "items": obj({"inicio": num, "fin": num, "escala": num}, ["inicio", "fin", "escala"])},
        "transiciones": {"type": "array", "items": obj({"tiempo": num, "tipo": {
            "type": "string", "enum": ["fade", "flash", "zoom", "whip", "glitch"]}}, ["tiempo", "tipo"])},
        "resumen": s,
    }, ["quitar", "titulos", "emojis", "zooms", "transiciones", "resumen"])


SYSTEM_EDITOR = """Eres un editor de vídeo profesional que trabaja para creadores de contenido en español.
Recibes la transcripción de un vídeo ya limpio de silencios (tiempos en segundos del vídeo final)
y devuelves decisiones creativas en JSON. Criterios:
- "quitar": solo tomas falsas, frases repetidas (quédate con la ÚLTIMA versión buena), errores o
  muletillas que hayan quedado. Usa exactamente los tiempos de la transcripción. Sé conservador:
  nunca quites contenido con información.
- "titulos": pocos y con intención (título al principio si procede, ideas clave, datos). Texto corto
  (máx. 6 palabras), sin repetir literalmente el subtítulo. Duración 1.5–4 s.
- "emojis": solo del catálogo dado, relacionados con lo que se dice en ese instante, con moderación
  (respeta el máximo por minuto) y nunca dos a menos de 4 s.
- "zooms": acercamientos suaves (escala 1.08–1.25) en frases importantes o remates, de 1.5–5 s.
- "transiciones": solo en los cortes listados donde cambia de tema o escena y aporten; si no aportan,
  ninguna. El tiempo debe ser uno de los cortes.
- "resumen": una frase en español explicando la edición.
Intensidad creativa (0–1) indica cuánto añadir."""


def creative_decisions(phrases: list[dict], cuts: list[float], duration: float, settings: dict) -> Decisiones:
    """Pide a Claude las decisiones creativas. Reintenta una vez si el JSON no es válido."""
    cat = emoji_catalog()
    max_emojis = int(round(settings.get("emojisPerMinute", 3) * max(duration, 1) / 60))
    lines = "\n".join(f"[{p['start']:.2f}-{p['end']:.2f}] {p['text']}" for p in phrases)
    user = (
        f"Duración del vídeo: {duration:.2f} s\nIntensidad creativa: {settings.get('intensity', 0.6)}\n"
        f"Pasos activados: títulos={settings.get('texts', True)}, emojis={settings.get('emojis', True)} "
        f"(máximo {max_emojis} en total), zooms={settings.get('smoothZooms', True)}, "
        f"transiciones={settings.get('transitions', True)}, tomas falsas={settings.get('retakes', True)}\n"
        f"Cortes existentes (s): {', '.join(f'{c:.2f}' for c in cuts) or 'ninguno'}\n"
        f"Catálogo de emojis: {' '.join(e['emoji'] for e in cat)}\n\n"
        f"Transcripción:\n{lines}\n\nDevuelve solo el JSON. Deja vacías las listas de pasos desactivados."
    )
    messages = [{"role": "user", "content": user}]
    last_error = ""
    for attempt in range(2):
        resp = create_message(model=ANTHROPIC_MODEL, max_tokens=16000, system=SYSTEM_EDITOR,
                              output_config={"effort": "medium",
                                             "format": {"type": "json_schema", "schema": _json_schema()}},
                              messages=messages)
        if resp.stop_reason == "refusal":
            raise RuntimeError("La IA rechazó la petición")
        raw = text_of(resp)
        try:
            return Decisiones.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError) as e:
            last_error = str(e)[:800]
            messages = [{"role": "user", "content": user},
                        {"role": "assistant", "content": raw or "{}"},
                        {"role": "user", "content": f"El JSON no es válido: {last_error}. Corrígelo y devuelve solo el JSON."}]
    raise ValueError(f"Respuesta de la IA no válida tras reintentar: {last_error}")


# ====================================================================== continuidad entre clips
def rate_continuity(items: list[dict]) -> list[dict]:
    schema = {"type": "object", "properties": {"pares": {"type": "array", "items": {
        "type": "object", "properties": {"par": {"type": "string"}, "continuidad": {"type": "number"}},
        "required": ["par", "continuidad"], "additionalProperties": False}}},
        "required": ["pares"], "additionalProperties": False}
    prompt = ("Para cada par, valora de 0 a 1 si el inicio del clip B continúa directamente el final del "
              "clip A (misma conversación, frase o idea que sigue). 1 = continúa claramente, 0 = no tiene "
              "relación.\n\n" + json.dumps(items, ensure_ascii=False))
    resp = create_message(model=ANTHROPIC_MODEL, max_tokens=8000,
                          output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
                          messages=[{"role": "user", "content": prompt}])
    return json.loads(text_of(resp)).get("pares", [])


def validate_decisions(dec: Decisiones, duration: float, cuts: list[float], settings: dict) -> tuple[Decisiones, list[str]]:
    """Comprobaciones semánticas: tiempos dentro del vídeo, emojis del catálogo, límites, cortes."""
    notes = []
    cat = {e["emoji"] for e in emoji_catalog()}
    clamp = lambda t: max(0.0, min(duration, t))
    dec.quitar = [q for q in dec.quitar if 0 <= q.inicio < q.fin <= duration + 0.05 and q.fin - q.inicio < 30]
    dec.titulos = [t for t in dec.titulos if t.inicio < duration and t.fin > t.inicio]
    for t in dec.titulos:
        t.fin = clamp(min(t.fin, t.inicio + 6))
    ok_emojis, last = [], -99.0
    max_emojis = int(round(settings.get("emojisPerMinute", 3) * max(duration, 1) / 60))
    for e in sorted(dec.emojis, key=lambda e: e.tiempo):
        if e.emoji not in cat:
            notes.append(f"Emoji {e.emoji} descartado (no está en el set)")
            continue
        if e.tiempo - last < 4 or e.tiempo >= duration or len(ok_emojis) >= max_emojis:
            continue
        ok_emojis.append(e)
        last = e.tiempo
    dec.emojis = ok_emojis
    dec.zooms = [z for z in dec.zooms if z.inicio < duration and z.fin > z.inicio + 0.3]
    for z in dec.zooms:
        z.fin = clamp(z.fin)
    snapped = []
    for tr in dec.transiciones:
        near = min(cuts, key=lambda c: abs(c - tr.tiempo)) if cuts else None
        if near is not None and abs(near - tr.tiempo) <= 0.5:
            tr.tiempo = near
            snapped.append(tr)
    dec.transiciones = snapped
    return dec, notes
