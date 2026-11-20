"""Seguimiento de cara: trayectoria suave y reencuadre que sigue al objetivo en el MP4 final."""

from __future__ import annotations

import subprocess

import numpy as np

from app.media import facetrack
from app.media import render as render_mod
from app.media.editspec import EditSpec


def _dets(xs, y=0.4, size=0.1, every=0.25):
    return [(round(i * every, 3), [] if x is None else [(x, y, size, size)]) for i, x in enumerate(xs)]


def test_track_follows_and_ignores_jitter():
    # cara quieta con temblor pequeño: la cámara no se mueve
    rng = np.random.default_rng(1)
    still = facetrack.build_track(_dets([0.5 + rng.uniform(-0.01, 0.01) for _ in range(40)]))
    assert still and max(p["x"] for p in still) - min(p["x"] for p in still) < 0.02
    # la cara cruza la imagen con huecos sin detección: la trayectoria la sigue y rellena huecos
    xs = [0.2 + 0.6 * i / 59 if i % 7 else None for i in range(60)]
    moving = facetrack.build_track(_dets(xs))
    assert moving[0]["x"] < 0.3 and moving[-1]["x"] > 0.65
    assert all(b["x"] >= a["x"] - 1e-6 for a, b in zip(moving, moving[1:]))


def test_track_zone_and_no_faces():
    dets = [(i * 0.25, [(0.85, 0.15, 0.06, 0.08), (0.4, 0.6, 0.2, 0.25)]) for i in range(20)]
    cam = facetrack.build_track(dets, zone={"x": 0.7, "y": 0.0, "w": 0.3, "h": 0.3})
    assert cam and abs(cam[0]["x"] - 0.85) < 0.01
    assert facetrack.build_track(_dets([None] * 30)) == []


def test_render_crop_follows_target(tmp_path, monkeypatch):
    """Un cuadrado rojo cruza un vídeo 16:9; con seguimiento, en el 9:16 queda siempre cerca del centro."""
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1280x720:d=8:r=30",
                    "-f", "lavfi", "-i", "color=c=red:s=100x100:d=8:r=30", "-f", "lavfi", "-i", "sine=f=440:d=8",
                    "-filter_complex", "[0][1]overlay=x='150+t*120':y=310[v]", "-map", "[v]", "-map", "2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src)], check=True)
    dets = [(i / 4, [((200 + (i / 4) * 120) / 1280, 360 / 720, 0.08, 0.14)]) for i in range(33)]
    monkeypatch.setattr(facetrack, "detections", lambda *a, **k: dets)
    spec = EditSpec.model_validate({"source_asset_id": "x", "format": "9:16",
                                    "layout": {"mode": "crop", "main": {"x": 0, "y": 0, "w": 1, "h": 1},
                                               "face_track": True},
                                    "segments": [{"start": 0.5, "end": 3.0}, {"start": 4.0, "end": 7.5}],
                                    "subtitles": {"enabled": False}})
    out = tmp_path / "out.mp4"
    res = render_mod.render(spec, src, out, tmp_path)
    assert (res.width, res.height) == (1080, 1920)
    for t in (0.5, 2.0, 4.0, 5.5):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(out), "-frames:v", "1",
                              "-vf", "scale=108:192", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             capture_output=True, check=True).stdout
        img = np.frombuffer(raw, np.uint8).reshape(192, 108, 3).astype(int)
        red = (img[..., 0] > 150) & (img[..., 1] < 90) & (img[..., 2] < 90)
        assert red.sum() > 20, t
        cx = np.nonzero(red)[1].mean()
        assert abs(cx - 54) < 18, (t, cx)


def test_split_without_tracking_unchanged():
    spec = EditSpec.model_validate({"source_asset_id": "x", "layout": {"mode": "split",
                                    "webcam": {"x": 0.7, "y": 0, "w": 0.3, "h": 0.3}},
                                    "segments": [{"start": 0, "end": 5}]})
    assert render_mod.face_tracks(spec, None, None, None) == {}  # type: ignore[arg-type]


def test_detector_available():
    from app.media.faces import FaceDetector
    assert FaceDetector(640, 360).available


def test_real_face_sample(tmp_path):
    """Con una foto real (STREAMCUT_FACE_SAMPLE=ruta.jpg): webcam detectada y encuadre que sigue la cara."""
    import os

    import pytest
    sample = os.environ.get("STREAMCUT_FACE_SAMPLE")
    if not sample:
        pytest.skip("define STREAMCUT_FACE_SAMPLE con una foto con una cara")
    from app.analysis import visual
    face = tmp_path / "face.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", sample, "-vf", "scale=720:-2", str(face)], check=True)
    vid = tmp_path / "moving.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404850:s=1280x720:d=10:r=30",
                    "-loop", "1", "-i", str(face), "-filter_complex", "[0][1]overlay=x='-200+t*60':y=150:shortest=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "10", str(vid)], check=True)
    track = facetrack.build_track(facetrack.detections(vid, 0, 10, 1280, 720, tmp_path / "c"))
    assert track and track[-1]["x"] - track[0]["x"] > 0.3
    assert visual.analyze(vid, 10, 1280, 720, 0.5).faces
