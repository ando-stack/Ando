"""Built-in vision model (VISION_PROVIDER=builtin).

Runs inside the backend with Hugging Face transformers, like faster-whisper in
AutoClips: `pip install -r requirements-ai.txt` and the model downloads by
itself the first time (~7 GB for Qwen2.5-VL-3B). No separate program, no keys.
Uses the GPU when available (CUDA / Apple MPS); otherwise CPU (very slow).

Small local models do not support constrained JSON decoding here, so the
schema goes in the prompt and the answer is extracted, validated and retried.
"""
from __future__ import annotations

import io
import json
import threading

from .local_ollama import SchemaError, validate
from .provider import Part, ProviderError, Usage, VisionProvider

_lock = threading.Lock()


def _compact_schema(schema: dict) -> str:
    return json.dumps(schema, ensure_ascii=False, separators=(",", ":"))


def _extract_json(text: str):
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise json.JSONDecodeError("no json", text, 0)
    return json.loads(text[start : end + 1])


class BuiltinProvider(VisionProvider):
    name = "builtin"

    def __init__(self, model: str, max_images: int, image_side: int):
        self.model = model
        self.max_images = max_images
        self.image_side = image_side
        self._model = None
        self._processor = None

    def configured(self) -> tuple[bool, str]:
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401
        except ImportError:
            return False, "Modelo integrado no instalado: pip install -r requirements-ai.txt (se descarga solo la primera vez)."
        import torch

        dev = "GPU CUDA" if torch.cuda.is_available() else "Apple MPS" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "CPU (lento)"
        return True, f"Modelo integrado {self.model} · {dev}"

    def _load(self):
        if self._model is None:
            from transformers import AutoModelForImageTextToText, AutoProcessor

            self._processor = AutoProcessor.from_pretrained(self.model)
            self._model = AutoModelForImageTextToText.from_pretrained(self.model, torch_dtype="auto", device_map="auto")
        return self._model, self._processor

    def complete_json(self, system: str, parts: list[Part], schema: dict, *, max_tokens: int = 4096) -> tuple[dict, Usage]:
        from PIL import Image

        content, n_img = [], 0
        for p in parts:
            if p.kind == "text":
                content.append({"type": "text", "text": p.text})
            else:
                n_img += 1
                im = Image.open(io.BytesIO(p.jpeg)).convert("RGB")
                im.thumbnail((self.image_side, self.image_side))
                content.append({"type": "image", "image": im})
        if n_img > self.max_images:
            raise ProviderError(f"Demasiadas imágenes para el modelo integrado ({n_img} > {self.max_images}).", code="ai_bad_request")
        content.append({"type": "text", "text": "Responde SOLO con un objeto JSON que cumpla este JSON Schema, sin texto adicional:\n" + _compact_schema(schema)})
        messages = [{"role": "system", "content": [{"type": "text", "text": system}]}, {"role": "user", "content": content}]
        with _lock:  # one generation at a time on the local device
            try:
                model, processor = self._load()
            except Exception as e:  # noqa: BLE001 - download / load errors
                raise ProviderError(f"No se pudo cargar el modelo integrado ({type(e).__name__}: {str(e)[:200]}).", code="ai_model")
            inputs = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt").to(model.device)
            out = model.generate(**inputs, max_new_tokens=min(max_tokens, 4096), do_sample=False)
            n_in = inputs["input_ids"].shape[1]
            text = processor.batch_decode(out[:, n_in:], skip_special_tokens=True)[0]
        try:
            data = validate(_extract_json(text), schema)
        except (json.JSONDecodeError, SchemaError) as e:
            raise ProviderError(f"El modelo integrado devolvió un JSON que no cumple el esquema ({e}).", retryable=True, code="ai_bad_json")
        return data, Usage(input_tokens=int(n_in), output_tokens=int(out.shape[1] - n_in), calls=1, images=n_img, models={f"builtin/{self.model}": 1})
