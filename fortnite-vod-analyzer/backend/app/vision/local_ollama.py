"""Local multimodal model through Ollama (https://ollama.com). No API keys,
nothing leaves the machine.

Setup on the coach's computer:
    1. Install Ollama.
    2. ollama pull qwen2.5vl:7b      (or another vision model)
    3. VISION_PROVIDER=ollama  VISION_MODEL=qwen2.5vl:7b  in backend/.env

Local vision models accept fewer images per request and follow JSON schemas
less reliably than large hosted models, so this provider caps images per
call, downsizes frames, enforces the schema with Ollama's structured output
(`format`) and validates the result itself, retrying on malformed output.
"""
from __future__ import annotations

import base64
import io
import json

import httpx

from .provider import Part, ProviderError, Usage, VisionProvider


class SchemaError(ValueError):
    pass


def validate(value, schema: dict, path: str = "$"):
    """Minimal JSON-schema check for the subset used in analysis/schemas.py.
    Returns a cleaned value (extra keys dropped, numbers coerced)."""
    types = schema.get("type")
    types = types if isinstance(types, list) else [types]
    if value is None:
        if "null" in types:
            return None
        raise SchemaError(f"{path}: null no permitido")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(f"{path}: valor '{value}' fuera de {schema['enum']}")
    if "object" in types:
        if not isinstance(value, dict):
            raise SchemaError(f"{path}: se esperaba objeto")
        out = {}
        for k, sub in schema.get("properties", {}).items():
            if k not in value:
                if k in schema.get("required", []):
                    # tolerate missing arrays / nullable fields; anything else is an error
                    if sub.get("type") == "array":
                        out[k] = []
                        continue
                    if isinstance(sub.get("type"), list) and "null" in sub["type"]:
                        out[k] = None
                        continue
                    raise SchemaError(f"{path}.{k}: falta")
                continue
            out[k] = validate(value[k], sub, f"{path}.{k}")
        return out
    if "array" in types:
        if not isinstance(value, list):
            raise SchemaError(f"{path}: se esperaba lista")
        return [validate(v, schema.get("items", {}), f"{path}[{i}]") for i, v in enumerate(value)]
    if "string" in types:
        if not isinstance(value, str):
            value = str(value)
        return value
    if "integer" in types:
        if isinstance(value, bool):
            raise SchemaError(f"{path}: se esperaba entero")
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            if "null" in types:
                return None
            raise SchemaError(f"{path}: se esperaba entero")
    if "number" in types:
        try:
            return float(value)
        except (TypeError, ValueError):
            raise SchemaError(f"{path}: se esperaba número")
    if "boolean" in types:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "sí", "si", "yes", "1")
        return bool(value)
    return value


def _shrink(jpeg: bytes, max_side: int) -> bytes:
    try:
        from PIL import Image
    except ImportError:
        return jpeg
    im = Image.open(io.BytesIO(jpeg))
    if max(im.size) <= max_side:
        return jpeg
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


class OllamaProvider(VisionProvider):
    name = "ollama"

    def __init__(self, model: str, base_url: str, max_images: int, image_side: int, num_ctx: int, timeout: float):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.max_images = max_images
        self.image_side = image_side
        self.num_ctx = num_ctx
        self.timeout = timeout

    def configured(self) -> tuple[bool, str]:
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=5)
            r.raise_for_status()
        except httpx.HTTPError:
            return False, f"Ollama no responde en {self.base_url}. Instálalo y ábrelo (ollama serve)."
        names = {m.get("name") for m in r.json().get("models", [])} | {m.get("model") for m in r.json().get("models", [])}
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        if self.model not in names and wanted not in names:
            return False, f"El modelo '{self.model}' no está descargado. Ejecuta: ollama pull {self.model}"
        return True, f"Ollama local · {self.model}"

    def complete_json(self, system: str, parts: list[Part], schema: dict, *, max_tokens: int = 16000) -> tuple[dict, Usage]:
        texts, images = [], []
        for p in parts:
            if p.kind == "text":
                texts.append(p.text)
            else:
                images.append(base64.standard_b64encode(_shrink(p.jpeg, self.image_side)).decode())
                texts.append(f"[imagen {len(images)}]")
        if len(images) > self.max_images:
            raise ProviderError(f"Demasiadas imágenes para el modelo local ({len(images)} > {self.max_images}).", code="ai_bad_request")
        prompt = "\n".join(texts) + "\n\nResponde SOLO con un objeto JSON válido que siga exactamente el esquema indicado."
        body = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "options": {"temperature": 0.2, "num_ctx": self.num_ctx, "num_predict": min(max_tokens, 8192)},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt, **({"images": images} if images else {})},
            ],
        }
        try:
            r = httpx.post(f"{self.base_url}/api/chat", json=body, timeout=self.timeout)
        except httpx.TimeoutException:
            raise ProviderError("El modelo local tardó demasiado (prueba un modelo más pequeño o menos fotogramas).", retryable=True, code="ai_timeout")
        except httpx.HTTPError:
            raise ProviderError(f"No se pudo conectar con Ollama en {self.base_url}.", code="ai_auth")
        if r.status_code == 404:
            raise ProviderError(f"Ollama no tiene el modelo '{self.model}'. Ejecuta: ollama pull {self.model}", code="ai_model")
        if r.status_code >= 400:
            raise ProviderError(f"Ollama devolvió un error ({r.status_code}): {r.text[:300]}", retryable=r.status_code >= 500)
        data = r.json()
        content = (data.get("message") or {}).get("content", "")
        try:
            parsed = validate(json.loads(content), schema)
        except (json.JSONDecodeError, SchemaError) as e:
            raise ProviderError(f"El modelo local devolvió un JSON que no cumple el esquema ({e}).", retryable=True, code="ai_bad_json")
        usage = Usage(input_tokens=data.get("prompt_eval_count", 0) or 0, output_tokens=data.get("eval_count", 0) or 0,
                      calls=1, images=len(images), models={f"ollama/{self.model}": 1})
        return parsed, usage
