"""Test setup.

Tests run the real API, real FFmpeg, real replay parsers and the real worker.
Only the multimodal model is replaced by ``ScriptedProvider``: a deterministic
stand-in that answers with schema-valid JSON citing the frame/event ids it was
actually sent, so we can verify the plumbing (timestamps, evidence validation,
scoring, persistence) without network access. It is never used by the app.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="fva-test-"))
os.environ.setdefault("DATA_DIR", str(_tmp / "data"))
os.environ.setdefault("APP_SECRET", "test-secret-0123456789abcdef0123456789")
os.environ.setdefault("UPLOAD_CHUNK_MB", "1")
os.environ.setdefault("SEGMENT_SECONDS", "20")
os.environ.setdefault("MAX_FRAMES_PER_SEGMENT", "6")
os.environ.setdefault("VISION_CONCURRENCY", "2")

from fastapi.testclient import TestClient  # noqa: E402

from app.vision.provider import Part, Usage, VisionProvider, set_provider  # noqa: E402

REPLAYS = Path(os.environ["FVA_TEST_REPLAYS"]) if os.environ.get("FVA_TEST_REPLAYS") else None


class ScriptedProvider(VisionProvider):
    name = "scripted-test"
    model = "scripted-test"

    def __init__(self):
        self.calls = []

    def configured(self):
        return True, "test"

    def complete_json(self, system, parts, schema, *, max_tokens=16000):
        return self._answer(system, parts, schema), Usage(calls=1, input_tokens=1000, output_tokens=200)

    def _answer(self, system, parts, schema):
        text = "\n".join(p.text for p in parts if p.kind == "text")
        self.calls.append((system[:40], len([p for p in parts if p.kind == "image"])))
        ids = re.findall(r"\b(F\d{4})\b", text)
        props = schema["properties"]
        if "segment_summary" in props:
            frames = list(dict.fromkeys(re.findall(r"^(F\d{4}) @", text, re.M)))
            return {
                "content_type": "gameplay", "image_quality": "good", "segment_summary": "Segmento de prueba",
                "frames": [{"frame": f, "situation": "fighting" if i % 2 else "rotating", "health": 100 - i, "shield": 50,
                            "wood": 500, "brick": 300, "metal": 100, "players_remaining": 80 - i, "eliminations": i // 3,
                            "storm_info": None, "height": "low_ground", "cover": "exposed", "zone": "safe_edge",
                            "description": f"Descripción {f}"} for i, f in enumerate(frames)],
                "events": [{"type": "fight_start", "frames": frames[:2], "description": "Pelea", "confidence": 0.8}],
                "observations": [{"category": "positioning", "kind": "mistake", "frames": frames[:1], "description": "Expuesto en low ground", "confidence": 0.7}],
                "not_verifiable": ["Velocidad de edición"],
            }
        if "findings" in props:
            evid = list(dict.fromkeys(ids)) or list(dict.fromkeys(re.findall(r"\b(E\d{3})\b", text)))
            return {
                "summary": "Resumen del módulo", "assessable": True,
                "findings": [
                    {"title": "Pelea en low ground", "category": "fight", "error_type": "positioning", "severity": "high",
                     "evidence": evid[:2], "what_happened": "Pelea desde abajo", "why_error": "Desventaja de altura",
                     "what_to_do": "Tomar altura antes", "how_to_avoid": "Practicar retakes", "confidence": 0.8},
                    {"title": "Afirmación inventada", "category": "decision", "error_type": "decision", "severity": "critical",
                     "evidence": ["F9999"], "what_happened": "x", "why_error": "x", "what_to_do": "x", "how_to_avoid": "x", "confidence": 0.9},
                ],
                "strengths": [{"description": "Buen tracking", "evidence": evid[:1]}],
                "not_assessable": [],
            }
        return {
            "match_summary": "Resumen", "overall_evaluation": "Evaluación", "strengths": ["A"], "weaknesses": ["B"],
            "top_errors_commentary": [{"finding_ref": "H001", "comment": "Prioridad"}],
            "early_game": "e", "mid_game": "m", "endgame": "f", "fights": "p",
            "recommendations": [{"title": "R", "detail": "D", "category": "fight"}],
            "drills": [{"name": "Box fights", "goal": "g", "how": "h", "duration_minutes": 20, "category": "fight"}],
            "next_session_goals": [{"title": "Tomar altura", "measurable_target": "3/5 peleas", "category": "positioning"}],
            "limitations": ["Prueba"],
        }


@pytest.fixture(scope="session")
def provider():
    p = ScriptedProvider()
    set_provider(p)
    return p


@pytest.fixture(scope="session")
def client(provider):
    from app.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def auth(client):
    r = client.post("/auth/register", json={"email": "coach@example.com", "password": "supersecret1", "display_name": "Coach"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """65 s synthetic MKV (non browser-playable container) with tone bursts."""
    out = tmp_path_factory.mktemp("vid") / "match.mkv"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=65",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=65",
        "-filter_complex", "[1:a]volume='if(between(mod(t,15),5,6),1.0,0.05)':eval=frame[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "mpeg4", "-q:v", "6", "-c:a", "libvorbis", str(out),
    ], check=True)
    return out


def upload(client, auth, match_id, path: Path, kind: str):
    data = path.read_bytes()
    r = client.post("/uploads", headers=auth, json={"match_id": match_id, "filename": path.name, "size_bytes": len(data), "kind": kind})
    assert r.status_code == 200, r.text
    up = r.json()
    off = 0
    while off < len(data):
        chunk = data[off: off + up["chunk_bytes"]]
        r = client.put(f"/uploads/{up['id']}?offset={off}", headers=auth, content=chunk)
        assert r.status_code == 200, r.text
        off = r.json()["received_bytes"]
    return client.post(f"/uploads/{up['id']}/complete", headers=auth)
