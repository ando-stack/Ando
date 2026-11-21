"""Rules mode (no generative AI): synthetic match video with a HUD drawn at the
preset positions, a loud fight, a storm segment and a low-mats endgame."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.hud.layout import DEFAULT_PRESET
from app.vision.provider import NoAIProvider, get_provider, set_provider
from app.worker import claim_job, run_job

from .conftest import upload

W, H, FPS, DUR = 1280, 720, 2, 90
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def hud_values(t: float) -> dict:
    v = {"health": 100, "shield": 100, "wood": 500, "brick": 300, "metal": 200, "players_remaining": 80, "eliminations": 0, "storm_timer": "1:30"}
    if t >= 26:
        v.update(health=40, shield=0)  # enters the fight at 40 hp, never heals
    if t >= 45:
        v.update(players_remaining=50, eliminations=1)
    if t >= 70:
        v.update(players_remaining=18, wood=100, brick=50, metal=0, storm_timer="0:12")
    return v


def make_video(out: Path) -> None:
    frames = out.parent / "frames"
    frames.mkdir(exist_ok=True)
    font = ImageFont.truetype(FONT, 20)
    for i in range(DUR * FPS):
        t = i / FPS
        im = Image.new("RGB", (W, H), (60 + (i * 7) % 60, 110, 70))
        d = ImageDraw.Draw(im)
        if 56 <= t < 72:  # storm: purple tint on the whole screen
            im = Image.blend(im, Image.new("RGB", (W, H), (150, 40, 210)), 0.7)
            d = ImageDraw.Draw(im)
        for k, (x0, y0, x1, y1) in DEFAULT_PRESET["rects"].items():
            d.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], fill=(15, 15, 20))
            d.text((x0 * W + 4, y0 * H + 1), str(hud_values(t)[k]), font=font, fill=(255, 255, 255))
        im.save(frames / f"{i:04d}.png")
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-framerate", str(FPS), "-i", str(frames / "%04d.png"),
        "-f", "lavfi", "-i", f"sine=frequency=300:duration={DUR}",
        "-filter_complex", "[1:a]volume='if(between(t,28,40),1.0,0.02)':eval=frame[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "10", "-c:a", "aac", "-shortest", str(out),
    ], check=True)


@pytest.fixture
def rules_mode():
    prev = get_provider()
    set_provider(NoAIProvider())
    yield
    set_provider(prev)


def test_rules_video_flow(client, auth, tmp_path, rules_mode):
    video = tmp_path / "hud_match.mp4"
    make_video(video)
    p = client.post("/players", headers=auth, json={"name": "HUD Player"}).json()
    m = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "Rules", "source_type": "video"}).json()
    assert upload(client, auth, m["id"], video, "video").status_code == 200

    # calibration API: live OCR test on a frame at t=10s with the preset
    lay = client.get(f"/players/{p['id']}/hud", headers=auth).json()
    r = client.post("/hud/test", headers=auth, json={"match_id": m["id"], "t": 10, "layout": lay}).json()
    vals = {k: v["value"] for k, v in r["fields"].items()}
    assert vals["health"] == 100 and vals["wood"] == 500 and vals["players_remaining"] == 80 and vals["storm_timer"] == 90
    assert client.get(f"/matches/{m['id']}/snapshot?t=60", headers=auth).content[:2] == b"\xff\xd8"
    saved = client.put(f"/players/{p['id']}/hud", headers=auth, json={"name": "Calibrado", "rects": lay["rects"], "calibrated": True}).json()
    assert saved["calibrated"]

    client.post(f"/matches/{m['id']}/analyze", headers=auth)
    while (j := claim_job("t")):
        run_job(j, "t")
    st = client.get(f"/matches/{m['id']}/job", headers=auth).json()
    assert st["job"]["status"] == "completed", st
    data = client.get(f"/matches/{m['id']}/analysis", headers=auth).json()
    a = data["analysis"]
    titles = {f["title"]: f for f in data["findings"]}
    assert all(f["origin"] == "rules" for f in data["findings"])
    storm = next(f for t, f in titles.items() if "tormenta" in t)
    assert 54 <= storm["t_start"] <= 58 and 68 <= storm["t_end"] <= 72
    fight = next(f for t, f in titles.items() if t.startswith("Pelea iniciada con 40"))
    assert 26 <= fight["evidence"][0]["t"] <= 30
    assert any("No se recupera" in t for t in titles)
    mats = next(f for t, f in titles.items() if "Endgame con solo 150" in t)
    assert mats["t_start"] >= 70 and mats["phase"] == "end"
    frames = {f["label"] for f in data["frames"]}
    assert all(e["id"] in frames for f in data["findings"] for e in f["evidence"])  # evidence images exist
    assert a["model"] == "reglas" and a["report"]["generated_by"] == "rules"
    assert a["scores"]["categories"]["mechanics"]["score"] is None and a["scores"]["overall"] is not None
    assert a["stats"]["hud_calibrated"] and a["stats"]["storm_seconds"] >= 12
    assert client.get(f"/matches/{m['id']}/report.pdf", headers=auth).content[:4] == b"%PDF"


from .conftest import REPLAYS  # noqa: E402


@pytest.mark.skipif(REPLAYS is None or not (REPLAYS / "season12.replay").exists(), reason="FVA_TEST_REPLAYS not set")
def test_rules_replay_flow(client, auth, rules_mode):
    p = client.post("/players", headers=auth, json={"name": "Replay Rules"}).json()
    m = client.post("/matches", headers=auth, json={"player_id": p["id"], "title": "S12 rules", "source_type": "replay"}).json()
    assert upload(client, auth, m["id"], REPLAYS / "season12.replay", "replay").status_code == 200
    client.post(f"/matches/{m['id']}/analyze", headers=auth)
    while (j := claim_job("t")):
        run_job(j, "t")
    data = client.get(f"/matches/{m['id']}/analysis", headers=auth).json()
    a = data["analysis"]
    assert a["model"] == "reglas" and a["coverage"]["mode"] == "rules"
    assert a["stats"]["eliminations"] == 7 and a["stats"]["placement"] == 1  # owner won with 7 kills
    assert any("Termina en el puesto 1" in s for s in a["report"]["strengths"])
    ids = {e["id"] for e in a["timeline"]}
    assert all(ev["id"] in ids for f in data["findings"] for ev in f["evidence"])
