"""Fixtures: genera clips de prueba con FFmpeg + espeak-ng y crea un proyecto real."""
import hashlib
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest

import tempfile

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# Los proyectos de prueba van a una carpeta temporal (antes de importar config)
_TMP = Path(tempfile.mkdtemp(prefix="editor-tests-"))
os.environ["PROJECTS_DIR"] = str(_TMP / "projects")


@pytest.fixture(scope="session")
def workdir():
    return _TMP


class FakeJob:
    def __init__(self):
        self.cancel_event = threading.Event()
        self.warnings = []
        self.messages = []

    def update(self, p=None, message=None):
        if message:
            self.messages.append(message)

    def sub(self, a, b):
        return lambda p: None


@pytest.fixture(scope="session")
def clips(workdir):
    if not shutil.which("espeak-ng"):
        pytest.skip("espeak-ng no instalado (necesario para generar voz de prueba)")
    out = workdir / "clips"
    subprocess.run([sys.executable, str(BACKEND / "tools" / "make_test_clips.py"), str(out), "--extra"], check=True,
                   capture_output=True)
    return out


def md5(p):
    return hashlib.md5(Path(p).read_bytes()).hexdigest()


@pytest.fixture(scope="session")
def imported(workdir, clips):
    """Importa los 4 clips (en orden desordenado) y analiza."""
    import ingest
    iid = ingest.new_import("prueba")
    d = ingest.import_dir(iid)
    data = ingest.load_import(iid)
    sums = {}
    for f in ["paisaje_playa.mov", "VID_0003.mp4", "VID_0001.mp4", "VID_0002.mp4"]:
        cid = ingest.new_id("clip")
        ext = Path(f).suffix
        shutil.copy(clips / f, d / "originales" / f"{cid}{ext}")
        sums[f"originales/{cid}{ext}"] = md5(clips / f)
        data["clips"].append({"id": cid, "name": f, "original": f"originales/{cid}{ext}"})
    ingest.save_import(iid, data)
    ingest.analyze_import(iid, FakeJob(), "es", False, "h264")
    return iid, sums


@pytest.fixture(scope="session")
def project_name(imported):
    import ingest
    iid, _ = imported
    data = ingest.load_import(iid)
    names = ingest.create_projects(iid, data["groups"])
    by_len = {}
    import project_ops as ops
    for n in names:
        by_len[n] = len(ops.load_dict(n)["sources"])
    return max(by_len, key=by_len.get)
