"""OllamaProvider against a fake Ollama HTTP server (real HTTP, real schema handling)."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.analysis.schemas import MODULE_SCHEMA, SEGMENT_SCHEMA
from app.vision.local_ollama import OllamaProvider, SchemaError, validate
from app.vision.provider import Part, ProviderError

REPLIES: list[str] = []
SEEN: list[dict] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        self._send(200, {"models": [{"name": "qwen2.5vl:7b", "model": "qwen2.5vl:7b"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(body)
        self._send(200, {"message": {"role": "assistant", "content": REPLIES.pop(0)}, "prompt_eval_count": 900, "eval_count": 120})


@pytest.fixture(scope="module")
def server():
    srv = HTTPServer(("127.0.0.1", 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def _jpeg():
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (1920, 1080), (20, 40, 200)).save(buf, "JPEG")
    return buf.getvalue()


def test_configured_and_missing_model(server):
    assert OllamaProvider("qwen2.5vl:7b", server, 6, 896, 8192, 30).configured()[0]
    ok, why = OllamaProvider("llava:13b", server, 6, 896, 8192, 30).configured()
    assert not ok and "ollama pull llava:13b" in why
    ok, why = OllamaProvider("x", "http://127.0.0.1:1", 6, 896, 8192, 2).configured()
    assert not ok and "no responde" in why


def test_structured_call(server):
    p = OllamaProvider("qwen2.5vl:7b", server, 6, 896, 8192, 30)
    REPLIES.append(json.dumps({"summary": "ok", "assessable": "true", "findings": [{
        "title": "t", "category": "fight", "error_type": "decision", "severity": "high", "evidence": ["F0001"],
        "what_happened": "a", "why_error": "b", "what_to_do": "c", "how_to_avoid": "d", "confidence": "0.7", "extra": 1}]}))
    data, usage = p.complete_json("sys", [Part.t("hola"), Part.img(_jpeg())], MODULE_SCHEMA)
    assert data["assessable"] is True and data["findings"][0]["confidence"] == 0.7
    assert data["strengths"] == [] and "extra" not in data["findings"][0]
    req = SEEN[-1]
    assert req["format"] == MODULE_SCHEMA and len(req["messages"][1]["images"]) == 1
    from PIL import Image
    import base64, io
    assert max(Image.open(io.BytesIO(base64.b64decode(req["messages"][1]["images"][0]))).size) == 896
    assert usage.images == 1 and usage.input_tokens == 900


def test_invalid_output_is_retryable(server):
    p = OllamaProvider("qwen2.5vl:7b", server, 6, 896, 8192, 30)
    REPLIES.append('{"summary": "x", "assessable": true, "findings": [{"category": "nope"}]}')
    with pytest.raises(ProviderError) as e:
        p.complete_json("sys", [Part.t("x")], MODULE_SCHEMA)
    assert e.value.retryable and e.value.code == "ai_bad_json"
    with pytest.raises(ProviderError):
        p.complete_json("sys", [Part.img(_jpeg())] * 7, MODULE_SCHEMA)


def test_validator_nullable_hud():
    frame = {"frame": "F0001", "situation": "fighting", "health": "85", "shield": None, "height": "level", "cover": "exposed",
             "zone": "unknown", "description": "d"}
    out = validate({"content_type": "gameplay", "image_quality": "fair", "segment_summary": "s", "frames": [frame], "events": [], "observations": []}, SEGMENT_SCHEMA)
    f = out["frames"][0]
    assert f["health"] == 85 and f["wood"] is None and out["not_verifiable"] == []
    with pytest.raises(SchemaError):
        validate({"content_type": "x"}, SEGMENT_SCHEMA)
