"""Multimodal model providers (server side only; keys never reach the browser).

A provider receives a system prompt, a list of content parts (text and JPEG
images) and a JSON schema, and must return a dict that validates against the
schema. Add a new provider by subclassing ``VisionProvider``.
"""
from __future__ import annotations

import base64
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from ..config import get_settings


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, code: str = "ai_error"):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.code = code


@dataclass
class Part:
    kind: str  # "text" | "image"
    text: str | None = None
    jpeg: bytes | None = None

    @staticmethod
    def t(text: str) -> "Part":
        return Part("text", text=text)

    @staticmethod
    def img(jpeg: bytes) -> "Part":
        return Part("image", jpeg=jpeg)


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    calls: int = 0
    images: int = 0
    models: dict = field(default_factory=dict)

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.calls += other.calls
        self.images += other.images
        for k, v in other.models.items():
            self.models[k] = self.models.get(k, 0) + v

    def as_dict(self) -> dict:
        return self.__dict__.copy()


class VisionProvider(ABC):
    name = "abstract"
    model = ""
    max_images = 20  # images per request the model handles well
    concurrency: int | None = None  # None = VISION_CONCURRENCY

    @abstractmethod
    def configured(self) -> tuple[bool, str]: ...

    @abstractmethod
    def complete_json(self, system: str, parts: list[Part], schema: dict, *, max_tokens: int = 16000) -> tuple[dict, Usage]: ...


class AnthropicProvider(VisionProvider):
    name = "anthropic"

    def __init__(self, model: str, effort: str, fallbacks: bool):
        self.model = model
        self.effort = effort
        self.fallbacks = fallbacks
        self._client = None

    def configured(self) -> tuple[bool, str]:
        if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE"):
            return True, f"Anthropic · {self.model}"
        return False, "Falta ANTHROPIC_API_KEY en el backend (.env del servidor)."

    @property
    def client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(max_retries=4, timeout=600.0)
        return self._client

    def complete_json(self, system: str, parts: list[Part], schema: dict, *, max_tokens: int = 32000) -> tuple[dict, Usage]:
        import anthropic

        content = []
        n_img = 0
        for p in parts:
            if p.kind == "text":
                content.append({"type": "text", "text": p.text})
            else:
                n_img += 1
                content.append(
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(p.jpeg).decode()},
                    }
                )
        kwargs = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
        )
        try:
            if self.fallbacks:
                with self.client.beta.messages.stream(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
                ) as stream:
                    msg = stream.get_final_message()
            else:
                with self.client.messages.stream(**kwargs) as stream:
                    msg = stream.get_final_message()
        except anthropic.AuthenticationError:
            raise ProviderError("Clave de API de Anthropic inválida.", code="ai_auth")
        except anthropic.PermissionDeniedError as e:
            raise ProviderError(f"La clave no tiene permiso para este modelo: {e.message}", code="ai_permission")
        except anthropic.NotFoundError:
            raise ProviderError(f"Modelo no encontrado: {self.model}", code="ai_model")
        except anthropic.BadRequestError as e:
            raise ProviderError(f"Petición rechazada por la API: {e.message}", code="ai_bad_request")
        except anthropic.RateLimitError:
            raise ProviderError("Límite de uso de la API alcanzado.", retryable=True, code="ai_rate_limit")
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Error del servicio de IA ({e.status_code}).", retryable=e.status_code >= 500)
        except anthropic.APIConnectionError:
            raise ProviderError("No se pudo conectar con la API de IA.", retryable=True, code="ai_network")

        if msg.stop_reason == "refusal":
            raise ProviderError("El modelo rechazó la petición.", code="ai_refusal")
        if msg.stop_reason == "max_tokens":
            raise ProviderError("La respuesta del modelo se cortó (max_tokens).", retryable=True, code="ai_truncated")
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise ProviderError("La IA devolvió un JSON inválido.", retryable=True, code="ai_bad_json")
        u = msg.usage
        usage = Usage(
            input_tokens=(u.input_tokens or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0),
            output_tokens=u.output_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            calls=1,
            images=n_img,
            models={msg.model: 1},
        )
        return data, usage


class NoAIProvider(VisionProvider):
    """Rules-only mode: no generative model is called."""

    name = "none"
    model = "reglas"

    def configured(self) -> tuple[bool, str]:
        return False, "Modo reglas: lectura del HUD y reglas de coaching, sin IA generativa."

    def complete_json(self, system, parts, schema, *, max_tokens=16000):  # pragma: no cover
        raise ProviderError("No hay modelo de IA configurado.", code="ai_not_configured")


_provider: VisionProvider | None = None


def get_provider() -> VisionProvider:
    global _provider
    if _provider is None:
        s = get_settings()
        if s.vision_provider == "none":
            _provider = NoAIProvider()
        elif s.vision_provider == "builtin":
            from .builtin import BuiltinProvider

            _provider = BuiltinProvider(s.vision_model, s.builtin_max_images, s.ollama_image_side)
            _provider.concurrency = 1
        elif s.vision_provider == "anthropic":
            _provider = AnthropicProvider(s.vision_model, s.vision_effort, s.vision_fallbacks)
        elif s.vision_provider == "ollama":
            from .local_ollama import OllamaProvider

            _provider = OllamaProvider(s.vision_model, s.ollama_url, s.ollama_max_images, s.ollama_image_side, s.ollama_num_ctx, s.ollama_timeout)
            _provider.concurrency = 1  # one GPU: run requests sequentially
        else:
            raise RuntimeError(f"VISION_PROVIDER desconocido: {s.vision_provider}")
    return _provider


def set_provider(p: VisionProvider | None) -> None:
    """Used by tests to inject a provider."""
    global _provider
    _provider = p
