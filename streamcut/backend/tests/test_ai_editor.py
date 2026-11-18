"""Editor IA: decisiones de edición (unidad) y flujo completo con vídeo real (API + workers)."""

from __future__ import annotations

import subprocess

import numpy as np

from app.analysis import audio as A
from app.analysis.transcribe import Segment, Word
from app.media.editspec import EditSpec
from app.services.ai_editor import _kept_segments, plan_edit
from app.services.templates import BUILTIN_TEMPLATES
from tests.conftest import upload_file
from tests.test_media import decode_ok, stream_durations

TPL = next(t for t in BUILTIN_TEMPLATES if t["slug"] == "gaming-viral")["spec"]


def _signal(duration=60.0):
    sr = 16000
    t = np.arange(int(duration * sr)) / sr
    rng = np.random.default_rng(3)
    x = rng.normal(0, 0.02, t.size).astype(np.float32)
    talk = np.zeros_like(t, dtype=bool)
    for a in (2, 8, 14, 30, 36, 44, 50):
        talk |= (t > a) & (t < a + 4)
    x[talk] *= 6
    x[(t > 20) & (t < 28)] *= 0.05  # 8 s de silencio muerto
    x[(t > 37) & (t < 39)] *= 6  # reacción fuerte
    return A.compute_features(x)


def _segments():
    texts = {2: "hola a todos bienvenidos", 8: "vamos a jugar una partida", 14: "mirad esto que pasa",
             30: "ahora viene lo bueno", 36: "¡No puede ser! ¡Qué locura!", 44: "seguimos con la partida",
             50: "gracias por estar aquí"}
    segs, words = [], []
    for a, txt in texts.items():
        ws = [Word(a + i * 0.5, a + i * 0.5 + 0.4, w, 0.9) for i, w in enumerate(txt.split())]
        segs.append(Segment(a, a + 0.5 * len(ws), txt, 0.9, ws))
        words += [{"start": w.start, "end": w.end, "text": w.text} for w in ws]
    return segs, words


def test_plan_cuts_silence_and_keeps_words():
    segs, words = _segments()
    kept = _kept_segments(0, 60, [(20.0, 28.0)], words)
    assert len(kept) == 2 and kept[0]["end"] < 21 and kept[1]["start"] > 27
    for w in words:  # ninguna palabra queda partida por un corte
        assert any(k["start"] <= w["start"] and w["end"] <= k["end"] for k in kept) or \
            all(not (k["start"] < w["end"] and w["start"] < k["end"]) for k in kept)


def test_plan_professional_choices():
    segs, words = _segments()
    feats = _signal()
    plan = plan_edit(asset_id="x", start=0, end=60, words=words, segments=segs, audio=feats, audio_offset=0,
                     template_spec=TPL, source_w=1920, source_h=1080, webcam=None, faces=None,
                     options={"subtitles": "key", "emotes": "few"}, fallback_title="Clip")
    spec, s = plan.spec, plan.summary
    assert s["removed_seconds"] >= 5  # se quitó el silencio muerto
    # subtítulos «de vez en cuando»: incluye la frase clave pero no todas
    texts = " ".join(c.text for c in spec.subtitles.cues).lower()
    assert "no puede ser" in texts
    assert len({c.text for c in spec.subtitles.cues}) < len(words) / 3
    assert spec.subtitles.style.uppercase
    # pocos emotes, lejos del título gancho
    assert 1 <= len(spec.overlays) <= 2
    assert all(o.t >= 2.8 for o in spec.overlays)
    assert spec.title_card.enabled and spec.title_card.text
    assert spec.format == "9:16"
    none = plan_edit(asset_id="x", start=0, end=60, words=words, segments=segs, audio=feats, audio_offset=0,
                     template_spec=TPL, source_w=1920, source_h=1080, webcam=None, faces=None,
                     options={"subtitles": "none", "emotes": "none", "hook_title": False, "cut_silences": False},
                     fallback_title="Clip").spec
    assert not none.overlays and not none.subtitles.cues and not none.title_card.enabled
    assert none.output_duration == 60


def test_upload_edit_mode_end_to_end(auth_client, worker, highlight_video, tmp_path):
    """Subir un clip en modo «Solo editar» → se edita con IA → MP4 vertical con emotes, subtítulos y gancho."""
    clip_file = tmp_path / "mi_clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "26", "-t", "30", "-i", str(highlight_video),
                    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(clip_file)], check=True)
    size = clip_file.stat().st_size
    uid = auth_client.post("/api/uploads", json={"filename": clip_file.name, "size": size}).json()["id"]
    auth_client.put(f"/api/uploads/{uid}?offset=0", content=clip_file.read_bytes())
    r = auth_client.post(f"/api/uploads/{uid}/complete", json={"mode": "edit", "options": {"emotes": "few"}})
    assert r.status_code == 200 and not r.json()["duplicate"], r.text
    worker.drain()
    jobs = auth_client.get("/api/ai-editor/jobs").json()
    j = next(x for x in jobs if x["clip"] and x["clip"]["source_asset_id"] == r.json()["asset"]["id"])
    assert j["job"]["status"] == "succeeded", j["job"]
    summary = j["job"]["result"]
    assert summary["format"] == "9:16" and summary["hook"]
    assert summary["captions"] >= 1 and len(summary["emotes"]) <= 2
    assert j["render"]["status"] == "succeeded"
    clip_id = j["clip"]["id"]
    detail = auth_client.get(f"/api/clips/{clip_id}").json()
    current = next(v for v in detail["versions"] if v["is_current"])
    assert current["note"] == "Edición IA" and current["status"] == "ready"
    out = tmp_path / "ia.mp4"
    out.write_bytes(auth_client.get(f"/api/clips/{clip_id}/download").content)
    decode_ok(out)
    v, a = stream_durations(out)
    assert abs(v - a) < 0.1
    # Reenviar el mismo clip al Editor IA con otras opciones crea una versión nueva
    r = auth_client.post("/api/ai-editor/jobs", json={"clip_ids": [clip_id], "options": {"subtitles": "full"}})
    assert len(r.json()["accepted"]) == 1
    worker.drain()
    versions = auth_client.get(f"/api/clips/{clip_id}").json()["versions"]
    assert len(versions) == 2 and versions[-1]["is_current"] and versions[-1]["status"] == "ready"


def test_send_platform_clip_without_video_is_rejected(auth_client):
    from sqlalchemy import select

    from app.db.models import Clip, Workspace
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        ws = db.scalar(select(Workspace))
        c = Clip(workspace_id=ws.id, origin="platform", title="solo enlace", status="detected", format="16:9",
                 platform="twitch", platform_clip_url="https://clips.twitch.tv/x")
        db.add(c)
        db.commit()
        cid = str(c.id)
    r = auth_client.post("/api/ai-editor/jobs", json={"clip_ids": [cid]}).json()
    assert not r["accepted"] and "Descargar" in r["rejected"][0]["reason"]
