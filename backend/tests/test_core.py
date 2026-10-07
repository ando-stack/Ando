import copy
import json

import numpy as np
import pytest

import schema
import project_ops as ops
from tests.conftest import FakeJob, md5


def base_project():
    return {"name": "t", "createdAt": "x", "updatedAt": "x",
            "sources": [{"id": "a", "name": "a.mp4", "original": "o/a.mp4", "duration": 10, "width": 1920,
                         "height": 1080, "fps": 30},
                        {"id": "b", "name": "b.mp4", "original": "o/b.mp4", "duration": 8, "width": 1920,
                         "height": 1080, "fps": 30}],
            "segments": [{"id": "s1", "sourceId": "a", "inPoint": 0, "outPoint": 10},
                         {"id": "s2", "sourceId": "b", "inPoint": 0, "outPoint": 8}]}


# ------------------------------------------------------------------ esquema
def test_schema_valid_and_defaults():
    p = schema.validate(base_project())
    assert p.duration() == 18
    assert p.tracks["video"].enabled


@pytest.mark.parametrize("mutate,msg", [
    (lambda p: p["segments"].append({"id": "s3", "sourceId": "zzz", "inPoint": 0, "outPoint": 1}), "no existe"),
    (lambda p: p.__setitem__("texts", [{"id": "t1", "start": 30, "end": 31, "text": "hola"}]), "después del final"),
    (lambda p: p.__setitem__("texts", [{"id": "t1", "start": 3, "end": 2, "text": "hola"}]), "mayor"),
    (lambda p: p["segments"][0].__setitem__("outPoint", 50), "supera la duración"),
    (lambda p: p.__setitem__("emojis", [{"id": "e", "start": 1, "end": 2, "emoji": "🔥", "file": "x.svg", "size": 5}]), "size"),
    (lambda p: p.__setitem__("inventado", 1), "Extra inputs"),
])
def test_schema_rejects(mutate, msg):
    p = base_project()
    mutate(p)
    with pytest.raises(schema.ProjectInvalid) as e:
        schema.validate(p)
    assert msg.lower() in str(e.value).lower()


def test_save_rejects_invalid_and_keeps_file(tmp_path):
    f = tmp_path / "project.json"
    schema.save(base_project(), f)
    before = f.read_text()
    bad = base_project()
    bad["segments"][0]["sourceId"] = "nada"
    with pytest.raises(schema.ProjectInvalid):
        schema.save(bad, f)
    assert f.read_text() == before


# ------------------------------------------------------------------ ripple
def test_ripple_delete_shifts_everything():
    p = schema.validate({**base_project(),
                         "texts": [{"id": "t1", "start": 12, "end": 14, "text": "x"}],
                         "emojis": [{"id": "e1", "start": 4.5, "end": 5.5, "emoji": "🔥", "file": "1f525.svg"}],
                         "transitions": [{"id": "tr", "at": 10}],
                         "captions": {"blocks": [{"id": "c1", "start": 3, "end": 7, "words": [
                             {"text": "a", "start": 3, "end": 3.5}, {"text": "b", "start": 4.2, "end": 4.6},
                             {"text": "c", "start": 6, "end": 7}]}]}}).model_dump(mode="json")
    q = ops.ripple_delete(p, 4, 6)
    schema.validate(q)
    assert ops.duration(q) == pytest.approx(16)
    assert q["texts"][0]["start"] == pytest.approx(10)
    assert q["emojis"] == []                     # estaba dentro del tramo
    assert q["transitions"][0]["at"] == pytest.approx(8)
    assert [w["text"] for w in q["captions"]["blocks"][0]["words"]] == ["a", "c"]
    assert [ (s["inPoint"], s["outPoint"]) for s in q["segments"]] == [(0, 4), (6, 10), (0, 8)]


def test_mapping_source_output():
    p = ops.ripple_delete(schema.validate(base_project()).model_dump(mode="json"), 2, 3)
    assert ops.source_to_output(p, "a", 5) == pytest.approx(4)
    assert ops.source_to_output(p, "a", 2.5) is None
    seg, t = ops.output_to_source(p, 9.5)
    assert seg["sourceId"] == "b" and t == pytest.approx(0.5)


# ------------------------------------------------------------------ limpieza
def test_cleanup_retake_and_fillers():
    import cleanup
    W = lambda t, a, b: {"text": t, "start": a, "end": b}
    words = [W("Hoy", 0, .3), W("os", .35, .5), W("voy", .55, .7), W("a", .75, .8), W("enseñar.", .85, 1.2),
             W("Eh,", 1.8, 2.0),
             W("Hoy", 2.6, 2.9), W("os", 2.95, 3.1), W("voy", 3.15, 3.3), W("a", 3.35, 3.4), W("enseñar", 3.45, 3.8),
             W("a", 3.85, 3.9), W("editar.", 3.95, 4.4)]
    keep, rem = cleanup.plan_source(words, [(1.25, 1.75), (2.05, 2.55)], 5.0,
                                    {"silences": True, "fillers": True, "retakes": True, "minSilence": .4,
                                     "silencePadding": .1})
    reasons = {r["reason"] for r in rem}
    assert {"toma repetida", "muletilla", "silencio"} <= reasons
    kept_words = [w["text"] for w in words if any(a <= (w["start"] + w["end"]) / 2 <= b for a, b in keep)]
    assert kept_words == ["Hoy", "os", "voy", "a", "enseñar", "a", "editar."]


# ------------------------------------------------------------------ color
def test_lut_cube_format_and_natural(tmp_path):
    import color
    params = {"gains": [1.0, 1.0, 1.1], "gamma": 0.6, "contrast": 0.1, "saturation": 1.05, "black": [0, 0, 0]}
    f = tmp_path / "lut.cube"
    color.write_cube(f, params, {}, 1.0)
    lines = f.read_text().splitlines()
    assert "LUT_3D_SIZE 33" in lines
    data = np.array([[float(x) for x in l.split()] for l in lines if l[:1].isdigit()])
    assert data.shape == (33 ** 3, 3)
    assert data.min() >= 0 and data.max() <= 1
    assert np.allclose(data[0], 0, atol=1e-3)          # el negro sigue siendo negro
    assert data[-1].min() > 0.95                       # el blanco no se apaga
    # monótono en la diagonal de grises
    grays = np.array([color.apply_transform(np.array([[v, v, v]], np.float32), params, {}, 1)[0].mean()
                      for v in np.linspace(0, 1, 50)])
    assert np.all(np.diff(grays) >= -1e-4)


def test_lut_intensity_zero_is_identity():
    import color
    x = np.random.rand(100, 3).astype(np.float32)
    out = color.apply_transform(x, {"gains": [1.2, 1, .8], "gamma": .5, "contrast": .2, "saturation": 1.3}, {}, 0.0)
    assert np.allclose(out, x)


# ------------------------------------------------------------------ flujo real con clips
def test_grouping_and_order(imported):
    import ingest
    iid, _ = imported
    data = ingest.load_import(iid)
    names = {c["id"]: c["name"] for c in data["clips"]}
    groups = sorted([[names[c] for c in g] for g in data["groups"]], key=len)
    assert groups == [["paisaje_playa.mov"], ["VID_0001.mp4", "VID_0002.mp4", "VID_0003.mp4"]]


def test_autoedit_without_ai(project_name, monkeypatch):
    import autoedit
    monkeypatch.delenv("EDITOR_FAKE_AI", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    p = ops.load_dict(project_name)
    p2, rep = autoedit.run(ops.project_dir(project_name), p, {}, FakeJob())
    ops.save(project_name, p2)
    assert ops.duration(p2) < sum(s["duration"] for s in p["sources"]) - 5   # silencios y tomas fuera
    assert p2["captions"]["blocks"]
    assert any("sin clave de API" in w for w in rep["warnings"])
    assert p2["color"]["needsCorrection"] and p2["color"]["enabled"]   # clips oscuros
    assert (ops.project_dir(project_name) / "lut.cube").exists()
    text = " ".join(w["text"] for w in ops.output_words(p2)).lower()
    assert text.count("hoy os voy a enseñar") == 1        # la toma repetida se quitó


def test_good_light_not_corrected(workdir, clips):
    import color
    fr = color.sample_frames(clips / "buena_luz.mp4", 3, 4)
    assert color.analyze(fr)["analysis"]["issues"] == []


def test_originals_untouched(imported):
    import ingest
    iid, sums = imported
    d = ingest.import_dir(iid)
    for rel, h in sums.items():
        assert md5(d / rel) == h


def test_faces_detect_and_verify(project_name):
    import faces
    p = ops.load_dict(project_name)
    assert p["faces"]["pixelate"] == []                    # nunca automático
    p = faces.analyze_project(ops.project_dir(project_name), p)
    assert len(p["faces"]["tracks"]) == 1
    p["faces"]["pixelate"] = faces.default_pixelate_items(p, "cara-1")
    schema.validate(p)
    res = faces.verify(ops.project_dir(project_name), p, max_frames=8)
    assert res and sum(1 for r in res if r["ok"]) >= len(res) - 1


def test_ffmpeg_error_is_logged(tmp_path):
    from utils import FFmpegError, run
    with pytest.raises(FFmpegError) as e:
        run(["ffmpeg", "-i", str(tmp_path / "no-existe.mp4"), str(tmp_path / "x.mp4")], tmp_path, "prueba de error")
    logs = list((tmp_path / "logs").glob("*.log"))
    assert logs and "COMANDO:" in logs[0].read_text() and "no-existe.mp4" in logs[0].read_text()
    assert "logs" in str(e.value) or "Falló" in str(e.value)
