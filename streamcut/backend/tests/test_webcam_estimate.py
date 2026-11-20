"""Distinguir una webcam superpuesta (esquina) de una cámara a pantalla completa (centro)."""

from app.analysis.visual import estimate_webcam
from app.media.facetrack import webcam_from_detections


def test_corner_webcam_detected():
    dets = [(i * 0.25, [(0.88, 0.15, 0.04, 0.08)]) for i in range(40)]
    cam = webcam_from_detections(dets)
    assert cam and cam["x"] > 0.7 and cam["y"] < 0.2


def test_fullscreen_camera_is_not_webcam():
    faces = [(i * 2.0, 0.42, 0.25, 0.16, 0.28) for i in range(20)]
    assert estimate_webcam(faces, 20) is None
