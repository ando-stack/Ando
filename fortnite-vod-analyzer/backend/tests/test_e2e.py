from __future__ import annotations

from pathlib import Path

import pytest

from app.worker import claim_job, run_job

from .conftest import REPLAYS, upload


def _drain():
    while True:
        jid = claim_job("test-worker")
        if not jid:
            break
        run_job(jid, "test-worker")


def test_auth_required(client):
    assert client.get("/players").status_code == 401


def test_video_flow(client, auth, sample_video, provider):
    p = client.post("/players", headers=auth, json={"name": "Jugador Uno", "platform": "PC", "region": "EU", "game_mode": "Solo"}).json()
    m = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "Cash Cup R1", "source_type": "video"}).json()

    # wrong extension is rejected before any byte is stored
    r = client.post("/uploads", headers=auth, json={"match_id": m["id"], "filename": "x.exe", "size_bytes": 10, "kind": "video"})
    assert r.status_code == 415

    r = upload(client, auth, m["id"], sample_video, "video")
    assert r.status_code == 200, r.text
    media = r.json()["media"]
    assert media["width"] == 640 and abs(media["duration_s"] - 65) < 1 and media["has_audio"]

    # duplicate detection (same file, other match)
    m2 = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "dup", "source_type": "video"}).json()
    r = upload(client, auth, m2["id"], sample_video, "video")
    assert r.status_code == 409

    r = client.post(f"/matches/{m['id']}/analyze", headers=auth)
    assert r.status_code == 200 and not r.json()["duplicate"]
    assert client.post(f"/matches/{m['id']}/analyze", headers=auth).json()["duplicate"]  # no duplicate jobs
    _drain()

    st = client.get(f"/matches/{m['id']}/job", headers=auth).json()
    assert st["job"]["status"] == "completed", st
    assert st["match_status"] == "completed"

    data = client.get(f"/matches/{m['id']}/analysis", headers=auth).json()
    a = data["analysis"]
    frames = {f["label"]: f["t"] for f in data["frames"]}
    assert len(frames) >= 8
    # every timestamp is a real sampled frame time inside the video
    for f in data["findings"]:
        for ev in f["evidence"]:
            assert ev["id"] in frames and abs(frames[ev["id"]] - ev["t"]) < 1e-6
        assert 0 <= f["t_start"] <= 65
    # the invented evidence id F9999 was dropped
    assert all(f["title"] != "Afirmación inventada" for f in data["findings"])
    assert a["coverage"]["dropped_unverified_claims"] > 0
    assert a["scores"]["overall"] is not None
    assert a["scores"]["categories"]["communication"]["score"] is None  # no speech-to-text -> not invented
    assert a["report"]["top_errors"] and "finding_id" in a["report"]["top_errors"][0]

    # playback proxy was created because MKV/mpeg4 is not browser playable
    md = client.get(f"/matches/{m['id']}", headers=auth).json()
    assert any(x["kind"] == "proxy" for x in md["media"])
    url = client.get(f"/media/{media['id']}/url", headers=auth).json()["url"]
    path = url.split("8000", 1)[1]
    r = client.get(path, headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100

    # coach review: dismiss a finding -> score recalculated
    fid = data["findings"][0]["id"]
    before = a["scores"]["overall"]
    client.patch(f"/findings/{fid}", headers=auth, json={"review_status": "dismissed"})
    after = client.get(f"/matches/{m['id']}/analysis", headers=auth).json()["analysis"]["scores"]["overall"]
    assert after >= before

    # coach marker + note
    r = client.post(f"/matches/{m['id']}/findings", headers=auth, json={"t_start": 12.5, "category": "rotation", "severity": "medium", "title": "Rotó tarde", "what_happened": "x"})
    assert r.status_code == 200
    assert client.post(f"/matches/{m['id']}/notes", headers=auth, json={"t": 30, "text": "Revisar este momento"}).status_code == 200

    # PDF
    r = client.get(f"/matches/{m['id']}/report.pdf", headers=auth)
    assert r.status_code == 200 and r.content[:4] == b"%PDF"

    # goals + dashboard + player profile
    assert client.post(f"/matches/{m['id']}/goals-from-report", headers=auth).json()["created"] == 1
    d = client.get("/dashboard", headers=auth).json()
    assert d["totals"]["analyses"] == 1 and d["pending_goals"]
    prof = client.get(f"/players/{p['id']}", headers=auth).json()
    assert prof["evolution"] and prof["goals"]

    # delete video keeps analysis
    assert client.delete(f"/matches/{m['id']}/media/{media['id']}", headers=auth).status_code == 200
    assert client.get(f"/matches/{m['id']}/analysis", headers=auth).json()["analysis"] is not None


def test_isolation_between_coaches(client, auth):
    other = client.post("/auth/register", json={"email": "other@example.com", "password": "supersecret2"}).json()
    h2 = {"Authorization": f"Bearer {other['token']}"}
    mine = client.get("/players", headers=auth).json()
    assert mine
    assert client.get(f"/players/{mine[0]['id']}", headers=h2).status_code == 404
    assert client.get("/players", headers=h2).json() == []


@pytest.mark.skipif(REPLAYS is None or not (REPLAYS / "chapter5season5.replay").exists(), reason="FVA_TEST_REPLAYS not set")
def test_replay_flow(client, auth):
    p = client.post("/players", headers=auth, json={"name": "Replay Player"}).json()
    m = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "Replay C5S5", "source_type": "replay"}).json()
    r = upload(client, auth, m["id"], REPLAYS / "chapter5season5.replay", "replay")
    assert r.status_code == 200, r.text
    assert r.json()["media"]["meta"]["season"] == "32.00"
    cands = client.get(f"/matches/{m['id']}/replay/players", headers=auth).json()
    assert cands["compatible"] and cands["players"]
    client.post(f"/matches/{m['id']}/analyze", headers=auth)
    _drain()
    data = client.get(f"/matches/{m['id']}/analysis", headers=auth).json()
    a = data["analysis"]
    assert a["source_type"] == "replay"
    assert a["stats"]["eliminations"] >= 0
    assert a["scores"]["categories"]["mechanics"]["score"] is None  # needs video
    ids = {e["id"]: e["t"] for e in a["timeline"]}
    for f in data["findings"]:
        assert all(ev["id"] in ids for ev in f["evidence"])


def test_invalid_replay_rejected(client, auth, tmp_path: Path):
    p = client.post("/players", headers=auth, json={"name": "Bad"}).json()
    m = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "bad", "source_type": "replay"}).json()
    bad = tmp_path / "fake.replay"
    bad.write_bytes(b"MZ" + b"\x00" * 5000)
    r = upload(client, auth, m["id"], bad, "replay")
    assert r.status_code == 415 and "Replay no válida" in r.json()["detail"]
