import os
import sys
import tempfile
from pathlib import Path

# Directorio de datos aislado ANTES de importar la app.
_TMP = tempfile.mkdtemp(prefix="classforge-test-")
os.environ["CLASSFORGE_DATA_DIR"] = _TMP
os.environ.setdefault("ANTHROPIC_API_KEY", "")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture
def tmp(tmp_path: Path) -> Path:
    return tmp_path
