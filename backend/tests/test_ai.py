"""IA con el simulador (tests/fake_claude.py): decisiones creativas y chat con herramientas."""
import pytest

import project_ops as ops
import schema
from tests.conftest import FakeJob


@pytest.fixture()
def fake_ai(monkeypatch):
    monkeypatch.setenv("EDITOR_FAKE_AI", "1")


def test_creative_decisions_applied(project_name, fake_ai):
    import autoedit
    p = ops.load_dict(project_name)
    p2, rep = autoedit.run(ops.project_dir(project_name), p, {"emojisPerMinute": 6}, FakeJob())
    schema.validate(p2)
    assert p2["texts"] and p2["emojis"] and p2["transitions"]
    assert any(z["kind"] == "smooth" for z in p2["zooms"]) and any(z["kind"] == "punch" for z in p2["zooms"])
    cuts = [b for _s, _a, b in ops.segment_spans(p2)[:-1]]
    assert all(min(abs(t["at"] - c) for c in cuts) < 1e-3 for t in p2["transitions"])
    ops.save(project_name, p2)


def test_invalid_json_retries_then_falls_back(project_name, monkeypatch):
    import autoedit
    monkeypatch.setenv("EDITOR_FAKE_AI", "invalid")
    p = ops.load_dict(project_name)
    p2, rep = autoedit.run(ops.project_dir(project_name), p, {"color": False}, FakeJob())
    assert p2["texts"] == [] and p2["emojis"] == []
    assert p2["captions"]["blocks"]                         # los pasos automáticos sí se aplican
    assert any("no válida tras reintentar" in w for w in rep["warnings"])


REQUESTS = [
    ("Quita el emoji del segundo {emoji_t}", lambda a, b: len(b["emojis"]) == len(a["emojis"]) - 1),
    ("Pon los subtítulos más grandes", lambda a, b: b["captions"]["style"]["fontSize"] > a["captions"]["style"]["fontSize"]),
    ("Haz la iluminación más cálida", lambda a, b: b["color"]["temperature"] > a["color"]["temperature"]),
    ('Añade un título "Bienvenidos" cuando digo "bienvenidos"', lambda a, b: any(t["text"] == "Bienvenidos" for t in b["texts"])),
    ("Recorta del 0:05 al 0:07", lambda a, b: ops.duration(b) == pytest.approx(ops.duration(a) - 2, abs=0.01)),
    ("Mueve el texto «Bienvenidos» al segundo 3", lambda a, b: any(t["text"] == "Bienvenidos" and t["start"] == 3 for t in b["texts"])),
    ("Pon un zoom suave en el segundo 10", lambda a, b: len(b["zooms"]) == len(a["zooms"]) + 1),
    ("Pon una transición destello en el primer corte", lambda a, b: len(b["transitions"]) == len(a["transitions"]) + 1),
    ("Pon un emoji 🚀 en el 0:15", lambda a, b: any(e["emoji"] == "🚀" for e in b["emojis"])),
    ("Pon la voz al 1,3", lambda a, b: b["audio"]["voiceVolume"] == pytest.approx(1.3)),
    ("Pixela la cara", lambda a, b: len(b["faces"]["pixelate"]) > 0),
    ("Quita el pixelado", lambda a, b: b["faces"]["pixelate"] == []),
    ("Desactiva los emojis", lambda a, b: b["tracks"]["emojis"]["enabled"] is False),
]


def test_chat_requests(project_name, fake_ai):
    import chat
    d = ops.project_dir(project_name)
    p = ops.load_dict(project_name)
    assert p["emojis"], "el test necesita emojis (test_creative_decisions_applied)"
    emoji_t = round((p["emojis"][0]["start"] + p["emojis"][0]["end"]) / 2)
    for req, check in REQUESTS:
        res = chat.run_chat(d, p, req.format(emoji_t=emoji_t))
        new = schema.validate(res["project"]).model_dump(mode="json")
        assert check(p, new), f"Fallo en: {req} -> {res['reply']}"
        assert res["changes"], req
        p = ops.save(project_name, new).model_dump(mode="json")
    assert len(p["chat"]) == 2 * len(REQUESTS)


def test_chat_ambiguous_asks(project_name, fake_ai):
    import chat
    p = ops.load_dict(project_name)
    res = chat.run_chat(ops.project_dir(project_name), p, "Quita eso")
    assert res["changes"] == []
    assert "¿A qué elemento te refieres?" in res["reply"]
    q = dict(res["project"])
    q.pop("chat"), p.pop("chat")
    assert q == p                                          # nada cambiado salvo el historial del chat


def test_chat_rejects_invalid_change(project_name, fake_ai):
    import chat
    p = ops.load_dict(project_name)
    res = chat.run_chat(ops.project_dir(project_name), p, "Pon el texto «Hola» en el segundo 999")
    assert res["changes"] == []
    assert "No he podido" in res["reply"] and "inválido" in res["reply"]
    assert len(res["project"]["texts"]) == len(p["texts"])
