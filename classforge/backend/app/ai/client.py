"""Cliente de la API de Claude con salidas estructuradas validadas por Pydantic.

La clave de API solo existe en el servidor (variable ANTHROPIC_API_KEY)."""
from __future__ import annotations

import base64
import logging
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import settings

log = logging.getLogger("classforge.ai")
T = TypeVar("T", bound=BaseModel)


class AIError(Exception):
    """Error comprensible para el usuario."""


class AIBackend(Protocol):
    def structured(self, *, system: str, content: list[dict], schema: type[T], max_tokens: int = 64000) -> T: ...


class ClaudeBackend:
    def __init__(self) -> None:
        import anthropic

        if not settings.anthropic_api_key:
            raise AIError("La IA no está configurada: falta ANTHROPIC_API_KEY en el servidor.")
        self._anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3, timeout=900)

    def structured(self, *, system: str, content: list[dict], schema: type[T], max_tokens: int = 64000) -> T:
        a = self._anthropic
        kwargs: dict[str, Any] = dict(
            model=settings.model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            thinking={"type": "adaptive"},
            output_config={"effort": settings.effort},
            output_format=schema,
        )
        if settings.use_fallbacks:
            # Si el modelo principal rechaza la petición, la API la repite en otro modelo.
            kwargs["betas"] = ["server-side-fallback-2026-07-01"]
            kwargs["fallbacks"] = "default"
        try:
            # Streaming: evita timeouts HTTP con salidas largas (planes con mucho contenido).
            with self.client.beta.messages.stream(**kwargs) as stream:
                msg = stream.get_final_message()
        except a.AuthenticationError as e:
            raise AIError("La clave de la API de Claude no es válida.") from e
        except a.PermissionDeniedError as e:
            raise AIError("La clave de la API no tiene permisos para este modelo.") from e
        except a.RateLimitError as e:
            raise AIError("La API de Claude está saturada (límite de uso). Inténtalo en unos minutos.") from e
        except a.BadRequestError as e:
            raise AIError(f"La API rechazó la petición: {getattr(e, 'message', e)}") from e
        except a.APIStatusError as e:
            raise AIError(f"Error del servicio de IA ({e.status_code}). Inténtalo de nuevo.") from e
        except a.APIConnectionError as e:
            raise AIError("No se pudo conectar con la API de Claude.") from e

        log.info("IA: stop=%s in=%s out=%s cache_read=%s", msg.stop_reason, msg.usage.input_tokens, msg.usage.output_tokens,
                 getattr(msg.usage, "cache_read_input_tokens", None))
        if msg.stop_reason == "refusal":
            raise AIError("El modelo se negó a procesar estos documentos (filtro de seguridad).")
        if msg.stop_reason == "max_tokens":
            raise AIError("La respuesta de la IA fue demasiado larga y quedó cortada. Divide la tarea en menos archivos.")
        parsed = getattr(msg, "parsed_output", None)
        if isinstance(parsed, schema):
            return parsed
        text = next((b.text for b in msg.content if getattr(b, "type", "") == "text"), "")
        try:
            return schema.model_validate_json(text)
        except ValidationError as e:
            raise AIError("La IA devolvió una respuesta con formato inválido.") from e


_backend: AIBackend | None = None


def get_ai() -> AIBackend:
    """Devuelve el backend de IA (sustituible en pruebas con ``set_ai``)."""
    global _backend
    if _backend is None:
        _backend = ClaudeBackend()
    return _backend


def set_ai(backend: AIBackend | None) -> None:
    global _backend
    _backend = backend


def image_block(png: bytes) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(png).decode()}}
