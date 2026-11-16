"""Pruebas con archivos audiovisuales reales: metadatos, validación, proxies y render."""

from __future__ import annotations

import subprocess
import threading
from pathlib import Path

import pytest

from app.media import ffmpeg as ff
from app.media.editspec import EditSpec, cues_from_words
from app.media.render import render


def decode_ok(path: Path) -> None:
    """El MP4 se decodifica entero sin errores (reproducible)."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], capture_output=True, text=True)
    assert r.returncode == 0 and not r.stderr.strip(), r.stderr


def stream_durations(path: Path) -> tuple[float, float]:
    info = ff.probe(path)
    v = next(float(s["duration"]) for s in info.raw["streams"] if s["codec_type"] == "video")
    a = next(float(s["duration"]) for s in info.raw["streams"] if s["codec_type"] == "audio")
    return v, a


def test_probe_and_validate(highlight_video, tmp_path):
    info = ff.validate_video(highlight_video, "x.mp4")
    assert info.has_audio and info.has_video and abs(info.duration - 88) < 0.5
    assert (info.width, info.height) == (1280, 720)
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video" * 100)
    with pytest.raises(ff.MediaError):
        ff.validate_video(bad, "bad.mp4")
    with pytest.raises(ff.MediaError):
        ff.validate_video(highlight_video, "video.avi")


def test_proxy_thumbnail_waveform(highlight_video, tmp_path):
    proxy = tmp_path / "p.mp4"
    seen = []
    ff.make_proxy(highlight_video, proxy, 240, 88, progress=seen.append)
    pi = ff.probe(proxy)
    assert pi.height == 240 and abs(pi.duration - 88) < 0.5 and seen and max(seen) > 0.9
    thumb = tmp_path / "t.jpg"
    ff.thumbnail(highlight_video, thumb, 10)
    assert thumb.stat().st_size > 1000
    wav = tmp_path / "a.wav"
    ff.extract_audio(highlight_video, wav)
    peaks = ff.waveform_peaks(wav)
    assert abs(len(peaks) - 88 * 20) < 30 and max(peaks) > 0.1


def _words():
    return [{"start": 39.2 + i * 0.4, "end": 39.5 + i * 0.4, "text": w}
            for i, w in enumerate("No way oh my god that was insane we won lets go".split())]


@pytest.mark.parametrize("fmt,layout,size", [
    ("9:16", {"mode": "fit_blur"}, (1080, 1920)),
    ("9:16", {"mode": "split", "webcam": {"x": 0.7, "y": 0.0, "w": 0.3, "h": 0.3}}, (1080, 1920)),
    ("1:1", {"mode": "crop", "main": {"x": 0.2, "y": 0, "w": 0.6, "h": 1}}, (1080, 1080)),
    ("16:9", {"mode": "fit_black"}, (1920, 1080)),
])
def test_render_formats_with_subtitles(highlight_video, tmp_path, fmt, layout, size):
    spec = EditSpec.model_validate({
        "source_asset_id": "x", "format": fmt, "layout": layout,
        "segments": [{"start": 36.0, "end": 41.0}, {"start": 42.0, "end": 46.5}],
        "zoom": {"enabled": True, "punch_ins": [{"t": 3.0, "duration": 1.5, "scale": 1.2}]},
        "subtitles": {"enabled": True, "style": {"animation": "pop"}, "cues": cues_from_words(_words(), 36, 47)},
        "audio": {"normalize": True, "limiter": True, "denoise": True},
    })
    out = tmp_path / "out.mp4"
    res = render(spec, highlight_video, out, tmp_path)
    assert (res.width, res.height) == size
    assert abs(res.duration - 9.5) < 0.15
    v, a = stream_durations(out)
    assert abs(v - a) < 0.1, (v, a)
    decode_ok(out)
    # Los subtítulos se queman en la imagen: el ASS contiene el texto con resaltado
    ass = (tmp_path / "subs.ass").read_text()
    assert "insane" in ass and "\\c&H" in ass


def test_render_source_without_audio(silent_video, tmp_path):
    spec = EditSpec.model_validate({"source_asset_id": "x", "segments": [{"start": 2, "end": 8}],
                                    "subtitles": {"enabled": False}})
    out = tmp_path / "o.mp4"
    res = render(spec, silent_video, out, tmp_path)
    assert abs(res.duration - 6) < 0.15
    decode_ok(out)


def test_render_cancellation(highlight_video, tmp_path):
    spec = EditSpec.model_validate({"source_asset_id": "x", "segments": [{"start": 0, "end": 80}],
                                    "subtitles": {"enabled": False}})
    flag = threading.Event()
    threading.Timer(1.0, flag.set).start()
    with pytest.raises(ff.Cancelled):
        render(spec, highlight_video, tmp_path / "c.mp4", tmp_path, cancel=flag.is_set)
