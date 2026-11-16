"""Flujo completo extremo a extremo contra la API real, con workers reales y un vídeo real.

importar (subida reanudable) → ingesta (metadatos, miniatura, audio, proxy, waveform) → análisis
(audio, transcripción Whisper, semántica, visual) → candidatos → clips → render MP4 con subtítulos →
biblioteca (búsqueda por texto hablado, filtros, favoritos, etiquetas, colecciones) → editor
(operaciones no destructivas, nueva versión) → descarga → papelera/recuperación → persistencia.
"""

from __future__ import annotations

import io
import json
import subprocess
import zipfile

from tests.conftest import upload_file
from tests.test_media import decode_ok, stream_durations


def test_auth_required(client):
    assert client.get("/api/clips").status_code == 401
    assert client.get("/api/channels").status_code == 401


def test_csrf_origin_check(auth_client):
    r = auth_client.post("/api/collections", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_resumable_upload_validation(auth_client, tmp_path):
    bad = tmp_path / "clip.avi"
    bad.write_bytes(b"x")
    assert auth_client.post("/api/uploads", json={"filename": bad.name, "size": 1}).status_code == 422
    fake = tmp_path / "fake.mp4"
    fake.write_bytes(b"0" * 5000)
    r = auth_client.post("/api/uploads", json={"filename": fake.name, "size": 5000}).json()
    uid = r["id"]
    # offset incorrecto → 409 con el offset real (reanudación)
    r2 = auth_client.put(f"/api/uploads/{uid}?offset=100", content=b"0" * 10)
    assert r2.status_code == 409
    auth_client.put(f"/api/uploads/{uid}?offset=0", content=b"0" * 3000)
    assert auth_client.get(f"/api/uploads/{uid}").json()["offset"] == 3000
    # incompleto → 409
    assert auth_client.post(f"/api/uploads/{uid}/complete", json={}).status_code == 409
    auth_client.put(f"/api/uploads/{uid}?offset=3000", content=b"0" * 2000)
    # más de lo declarado → 413
    assert auth_client.put(f"/api/uploads/{uid}?offset=5000", content=b"0").status_code == 413
    assert auth_client.delete(f"/api/uploads/{uid}").status_code == 200


def test_invalid_file_fails_ingestion(auth_client, worker, tmp_path):
    fake = tmp_path / "broken.mp4"
    fake.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"garbage" * 2000)
    res = upload_file(auth_client, fake)
    worker.drain()
    a = auth_client.get(f"/api/assets/{res['asset']['id']}").json()
    assert a["status"] == "failed"
    assert a["ingestion"]["status"] == "failed" and a["ingestion"]["error"]
    # reintento manual disponible
    r = auth_client.post(f"/api/jobs/ingestion/{a['ingestion']['id']}/retry")
    assert r.status_code == 200
    worker.drain()


def test_full_flow(auth_client, worker, highlight_video, tmp_path):
    c = auth_client
    res = upload_file(c, highlight_video, chunk=300_000, title="Partida de prueba")
    assert res["duplicate"] is False
    asset_id = res["asset"]["id"]
    worker.drain()

    a = c.get(f"/api/assets/{asset_id}").json()
    assert a["status"] == "ready", a
    assert abs(a["duration"] - 88) < 0.5 and a["width"] == 1280 and a["has_audio"]
    assert a["thumbnail_url"] and a["proxy_url"] and a["waveform_url"]
    assert a["analysis"]["status"] == "succeeded", a["analysis"]
    result = a["analysis"]["result"]
    assert result["language"] == "en"
    assert result["candidates"] >= 1

    # Transcripción con timestamps por palabra
    tr = c.get(f"/api/assets/{asset_id}/transcript").json()
    assert any("welcome" in s["text"].lower() for s in tr)
    assert all(s["words"] for s in tr)

    # El mejor candidato es el momento real (39-47 s)
    cands = a["candidates"]
    best = max((x for x in cands if x["status"] != "duplicate"), key=lambda x: x["score"])
    assert best["start"] <= 41 and best["end"] >= 43, best
    assert 0 <= best["score"] <= 100 and best["explanation"] and best["scores"]

    # Clips creados y renderizados automáticamente
    lib = c.get("/api/clips", params={"source_asset_id": asset_id, "sort": "score"}).json()
    assert lib["total"] >= 1
    top = lib["items"][0]
    assert top["status"] == "pending" and top["video_url"] and top["thumbnail_url"]
    detail = c.get(f"/api/clips/{top['id']}").json()
    assert detail["candidate"]["explanation"]
    assert detail["versions"][0]["av_sync_diff"] < 0.1

    # Descarga del MP4: reproducible, 9:16, audio y vídeo sincronizados
    r = c.get(f"/api/clips/{top['id']}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4"
    out = tmp_path / "clip.mp4"
    out.write_bytes(r.content)
    decode_ok(out)
    v, au = stream_durations(out)
    assert abs(v - au) < 0.1
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(out)],
                                      capture_output=True, text=True).stdout)
    vs = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (vs["width"], vs["height"]) == (1080, 1920)
    assert c.get(f"/api/clips/{top['id']}").json()["status"] == "exported"

    # Streaming con Range (seek en el reproductor)
    r = c.get(top["video_url"], headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100

    # Búsqueda por texto hablado, filtros, favoritos, etiquetas
    found = c.get("/api/clips", params={"q": "insane"}).json()
    assert any(x["id"] == top["id"] for x in found["items"]) or \
        any("insane" in (c.get(f"/api/clips/{x['id']}").json()["transcript_text"] or "").lower() for x in found["items"])
    r = c.patch(f"/api/clips/{top['id']}", json={"is_favorite": True, "tags": ["Épico", "victoria"],
                                                 "title": "Victoria épica"})
    assert r.status_code == 200 and r.json()["tags"] == ["victoria", "épico"]
    assert c.get("/api/clips", params={"favorite": True}).json()["total"] >= 1
    assert c.get("/api/clips", params={"tag": "victoria"}).json()["items"][0]["title"] == "Victoria épica"
    assert c.get("/api/clips", params={"q": "victoria"}).json()["total"] >= 1
    assert c.get("/api/clips", params={"min_score": 101}).json()["total"] == 0

    # Colecciones
    col = c.post("/api/collections", json={"name": "Mejores"}).json()
    c.post(f"/api/clips/{top['id']}/collections/{col['id']}")
    assert c.get("/api/clips", params={"collection_id": col["id"]}).json()["total"] == 1

    # Editor: operaciones no destructivas → nueva versión renderizada
    ed = c.get(f"/api/clips/{top['id']}/edit").json()
    spec = ed["spec"]
    assert ed["source"]["video_url"] and ed["words"]
    seg = spec["segments"][0]
    spec["segments"] = [{"start": seg["start"] + 1.0, "end": seg["start"] + 6.0},
                        {"start": seg["start"] + 8.0, "end": min(seg["end"], seg["start"] + 12.0)}]
    spec["format"] = "1:1"
    spec["subtitles"]["cues"] = [{"start": seg["start"] + 1.2, "end": seg["start"] + 3.0, "text": "TEXTO EDITADO",
                                  "words": []}]
    r = c.post(f"/api/clips/{top['id']}/edit/ops", json={"op_type": "trim_split_format", "payload": {},
                                                         "spec": spec, "base_seq": ed["head_seq"]})
    assert r.status_code == 200, r.text
    # conflicto de versión del proyecto
    assert c.post(f"/api/clips/{top['id']}/edit/ops", json={"op_type": "x", "payload": {}, "spec": spec,
                                                            "base_seq": ed["head_seq"]}).status_code == 409
    # especificación inválida
    bad = dict(spec, segments=[{"start": 0, "end": 99999}])
    assert c.post(f"/api/clips/{top['id']}/edit/ops", json={"op_type": "x", "payload": {}, "spec": bad,
                                                            "base_seq": r.json()["head_seq"]}).status_code == 422
    assert c.get(f"/api/clips/{top['id']}").json()["status"] == "editing"
    r = c.post(f"/api/clips/{top['id']}/edit/save", json={"note": "Recorte manual"})
    assert r.status_code == 200
    worker.drain()
    d = c.get(f"/api/clips/{top['id']}").json()
    assert len(d["versions"]) == 2 and d["versions"][1]["is_current"] and d["versions"][1]["status"] == "ready"
    assert abs(d["versions"][1]["duration"] - 9.0) < 0.2 and d["format"] == "1:1"
    # la versión 1 sigue disponible
    assert c.get(f"/api/clips/{top['id']}/download", params={"version": 1}).status_code == 200

    # Descarga múltiple en ZIP
    ids = [x["id"] for x in lib["items"][:2]]
    r = c.post("/api/clips/download", json={"ids": ids})
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert len(z.namelist()) == len(ids)

    # Exportar metadatos
    assert c.get("/api/clips/export-metadata", params={"format": "csv"}).text.startswith("id,title")

    # Duplicado detectado al volver a subir el mismo archivo
    dup = upload_file(c, highlight_video)
    assert dup["duplicate"] is True and dup["asset"]["id"] == asset_id

    # Papelera y recuperación
    assert c.delete(f"/api/clips/{top['id']}").status_code == 200
    assert all(x["id"] != top["id"] for x in c.get("/api/clips").json()["items"])
    assert any(x["id"] == top["id"] for x in c.get("/api/clips", params={"deleted": True}).json()["items"])
    c.post(f"/api/clips/{top['id']}/restore")
    assert any(x["id"] == top["id"] for x in c.get("/api/clips").json()["items"])

    # Reanálisis con otros parámetros (reutiliza audio y transcripción)
    r = c.post(f"/api/assets/{asset_id}/analyze", json={"duration_mode": "30", "no_clips": True})
    assert r.status_code == 200
    worker.drain()
    a2 = c.get(f"/api/assets/{asset_id}").json()
    assert a2["analysis"]["result"]["modalities"]["audio"] == "reutilizado"
    assert a2["analysis"]["result"]["modalities"]["transcription"] == "reutilizada"

    # Estadísticas reales
    st = c.get("/api/stats/dashboard").json()
    assert st["clips_created"] >= 1 and st["videos_imported"] >= 1 and st["hours_processed"] > 0
    ts = c.get("/api/stats/timeseries", params={"days": 7}).json()
    assert sum(d["clips"] for d in ts["daily"]) >= 1


def test_persistence_after_restart(auth_client):
    """Tras "cerrar y abrir" la app (nuevo proceso/app y nueva sesión) los clips siguen ahí."""
    from fastapi.testclient import TestClient

    from app.db.session import reset_engine
    from app.main import create_app
    reset_engine()
    with TestClient(create_app(), base_url="http://localhost") as c2:
        c2.post("/api/auth/login", json={"email": "admin@example.com", "password": "contraseña-segura-1"})
        items = c2.get("/api/clips").json()["items"]
        assert items and items[0]["video_url"]
        assert c2.get(items[0]["video_url"]).status_code == 200


def test_cancel_job(auth_client, worker, highlight_video):
    # Cancelación de un análisis en cola
    assets = auth_client.get("/api/assets").json()
    ready = next(a for a in assets if a["status"] == "ready")
    job = auth_client.post(f"/api/assets/{ready['id']}/analyze", json={"force": True, "no_clips": True}).json()
    r = auth_client.post(f"/api/jobs/analysis/{job['id']}/cancel")
    assert r.status_code == 200
    worker.drain()
    jobs = auth_client.get("/api/jobs", params={"kind": "analysis"}).json()
    j = next(x for x in jobs if x["id"] == job["id"])
    assert j["status"] == "cancelled"


def test_workspace_isolation(auth_client):
    """Otro usuario no puede ver ni tocar los recursos de este workspace."""
    from app.core.security import hash_password
    from app.db.models import Setting, User, Workspace
    from app.db.session import SessionLocal
    with SessionLocal() as db:
        u = User(email="otro@example.com", display_name="Otro", password_hash=hash_password("otra-contraseña-1"))
        db.add(u)
        db.flush()
        ws = Workspace(name="Otro", owner_id=u.id, storage_quota_bytes=10**9)
        db.add(ws)
        db.flush()
        db.add(Setting(workspace_id=ws.id, data={}))
        db.commit()
    clip_id = auth_client.get("/api/clips").json()["items"][0]["id"]
    asset_id = auth_client.get("/api/assets").json()[0]["id"]
    from fastapi.testclient import TestClient

    from app.main import create_app
    with TestClient(create_app(), base_url="http://localhost") as other:
        assert other.post("/api/auth/login", json={"email": "otro@example.com",
                                                   "password": "otra-contraseña-1"}).status_code == 200
        assert other.get(f"/api/clips/{clip_id}").status_code == 404
        assert other.get(f"/api/clips/{clip_id}/download").status_code == 404
        assert other.get(f"/api/assets/{asset_id}").status_code == 404
        assert other.get(f"/api/media/source/{asset_id}").status_code == 404
        assert other.delete(f"/api/clips/{clip_id}").status_code == 404
        assert other.get("/api/clips").json()["total"] == 0
