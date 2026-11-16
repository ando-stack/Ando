"""Prueba del flujo completo por HTTP con un backend de IA simulado SOLO en los tests
(la app real exige ANTHROPIC_API_KEY y nunca simula respuestas)."""
import io
import json
import re
import secrets
import zipfile

import docx
import openpyxl
import pytest
from fastapi.testclient import TestClient

from app import main, storage
from app.ai import client as ai_client
from app.ai.schemas import Interpretation, Plan, Review
from app.config import settings
from app.security import limiter
from tests import fixtures as fx


class FakeAI:
    """Devuelve respuestas deterministas leyendo los ids reales de los documentos."""

    def __init__(self):
        self.calls = []

    def structured(self, *, system, content, schema, max_tokens=64000):
        text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text")
        self.calls.append((schema.__name__, text))
        ids = dict(re.findall(r'<documento id="([^"]+)" nombre="([^"]+)"', text))
        by_name = {v: k for k, v in ids.items()}
        word, excel = by_name.get("Practica2.docx"), by_name.get("Ventas.xlsx")
        assert "SEGURIDAD" in system  # el prompt de sistema con las reglas anti-inyección siempre va
        if schema is Interpretation:
            return Interpretation.model_validate({
                "title": "Práctica 2", "subject": "Digitalización", "summary": "Completar Word y Excel.",
                "exercises": [{"id": "E1", "title": "RAM", "description": "Explicar", "source_files": ["Practica2.docx"], "deliverable_id": "D1"}],
                "requirements": [
                    {"id": "R1", "text": "Escribir nombre", "source": "Practica2.docx", "exercise_id": "general", "kind": "contenido", "mandatory": True},
                    {"id": "R2", "text": "Explicar la RAM", "source": "Practica2.docx", "exercise_id": "E1", "kind": "contenido", "mandatory": True},
                    {"id": "R3", "text": "Totales con fórmula", "source": "Ventas.xlsx", "exercise_id": "E2", "kind": "calculo", "mandatory": True},
                ],
                "resources": ["Datos de ventas"],
                "deliverables": [
                    {"id": "D1", "format": "docx", "filename": "Ana_Practica2.docx", "base_file_id": word, "description": "Word", "format_explicitly_required": True},
                    {"id": "D2", "format": "xlsx", "filename": "Ana_Ventas.xlsx", "base_file_id": excel, "description": "Excel", "format_explicitly_required": False},
                ],
                "tools_needed": ["fórmulas"], "ambiguities": [], "impossible": [{"text": "Imprimir", "suggestion": "Imprímelo tú"}], "suspicious_instructions": [],
            })
        if schema is Plan:
            explanation = "Inicio › Buscar y reemplazar"
            extra = "Corrección aplicada" if "REVISIÓN SOLICITADA" in text else "La RAM es memoria volátil."
            return Plan.model_validate({"deliverables": [
                {"id": "D1", "format": "docx", "filename": "Ana_Practica2.docx", "base_file_id": word, "purpose": "Word", "ops": [
                    {"op": "docx.replace_text", "args_json": json.dumps({"find": "Nombre y apellidos: ____________________", "replace": "Nombre y apellidos: {{ALUMNO}}"}), "covers": ["R1"], "explanation": explanation},
                    {"op": "docx.add_content", "args_json": json.dumps({"after_paragraph": 4, "blocks": [{"type": "paragraph", "text": extra}]}), "covers": ["R2"], "explanation": "Escribir"},
                ]},
                {"id": "D2", "format": "xlsx", "filename": "Ana_Ventas.xlsx", "base_file_id": excel, "purpose": "Excel", "ops": [
                    {"op": "xlsx.fill_formula", "args_json": json.dumps({"sheet": "Ventas", "range": "D3:D7", "formula": "=B3*C3"}), "covers": ["R3"], "explanation": "=B3*C3 y arrastrar"},
                ]},
            ], "notes": [], "unresolved": []})
        if schema is Review:
            return Review.model_validate({"items": [{"requirement_id": r, "status": "hecho", "comment": "ok"} for r in ("R1", "R2", "R3")], "overall": "Bien"})
        raise AssertionError(schema)


@pytest.fixture
def client(tmp_path):
    settings.anthropic_api_key = "test-key"
    fake = FakeAI()
    ai_client.set_ai(fake)
    limiter.reset()
    c = TestClient(main.app)
    c.fake = fake
    yield c
    ai_client.set_ai(None)
    settings.anthropic_api_key = None


def tok():
    return secrets.token_urlsafe(32)


def upload(client, token, tmp_path, extra=None):
    w = fx.make_word_template(tmp_path / "Practica2.docx")
    x = fx.make_excel_template(tmp_path / "Ventas.xlsx")
    files = [("files", ("Practica2.docx", w.read_bytes(), "application/octet-stream")), ("files", ("Ventas.xlsx", x.read_bytes(), "application/octet-stream"))]
    files += extra or []
    return client.post("/api/jobs", headers={"X-Client-Token": token}, files=files, data={"student_name": "Ana López", "date": "16/11/2026"})


def test_full_flow(client, tmp_path):
    t = tok()
    h = {"X-Client-Token": t}
    r = upload(client, t, tmp_path)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["progress"][0]["status"] == "done" and "owner_hash" not in job
    assert all("stored_name" not in f for f in job["files"])
    jid = job["id"]

    r = client.post(f"/api/jobs/{jid}/analyze", headers=h)
    assert r.status_code == 202
    job = client.get(f"/api/jobs/{jid}", headers=h).json()
    assert job["status"] == "analyzed" and job["analysis"]["subject"] == "Digitalización"
    # Los documentos se envían a la IA dentro de etiquetas <documento>
    assert '<documento id="' in client.fake.calls[0][1]

    r = client.post(f"/api/jobs/{jid}/generate", headers=h, json={"format_pref": "auto"})
    assert r.status_code == 202
    job = client.get(f"/api/jobs/{jid}", headers=h).json()
    v = job["versions"][0]
    assert v["validation"]["problems"] == [] and job["status"] == "completed", v["validation"]["problems"]
    assert [o["name"] for o in v["outputs"]] == ["Ana_Practica2.docx", "Ana_Ventas.xlsx"]
    assert all(s["status"] == "done" for s in job["progress"]), job["progress"]
    assert v["deliverables"][0]["steps"][0]["explanation"] == "Inicio › Buscar y reemplazar"

    # Descarga individual
    wid = v["outputs"][0]["id"]
    r = client.get(f"/api/jobs/{jid}/files/{wid}", headers=h)
    assert r.status_code == 200 and "Ana_Practica2.docx" in r.headers["content-disposition"]
    d = docx.Document(io.BytesIO(r.content))
    assert "Nombre y apellidos: Ana López" in [p.text for p in d.paragraphs]

    # Vista previa con CSP estricta
    r = client.get(f"/api/jobs/{jid}/files/{v['outputs'][1]['id']}/preview", headers=h)
    assert r.status_code == 200 and "default-src 'none'" in r.headers["content-security-policy"]
    assert "Ventas" in r.text and "<script" not in r.text

    # ZIP con todos los archivos y procedimiento
    r = client.get(f"/api/jobs/{jid}/versions/1/zip?with_steps=true", headers=h)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert sorted(z.namelist()) == ["Ana_Practica2.docx", "Ana_Ventas.xlsx", "Procedimiento_paso_a_paso.md"]
    wb = openpyxl.load_workbook(io.BytesIO(z.read("Ana_Ventas.xlsx")))
    assert wb["Ventas"]["D7"].value == "=B7*C7"

    # Corrección posterior → versión 2
    r = client.post(f"/api/jobs/{jid}/revise", headers=h, json={"feedback": "Añade más detalle a la RAM"})
    assert r.status_code == 202
    job = client.get(f"/api/jobs/{jid}", headers=h).json()
    assert len(job["versions"]) == 2 and job["versions"][1]["feedback"] == "Añade más detalle a la RAM"
    w2 = client.get(f"/api/jobs/{jid}/files/{job['versions'][1]['outputs'][0]['id']}", headers=h)
    assert "Corrección aplicada" in [p.text for p in docx.Document(io.BytesIO(w2.content)).paragraphs]

    # Historial
    hist = client.get("/api/jobs", headers=h).json()
    assert hist[0]["id"] == jid and hist[0]["versions"] == 2

    # Borrado
    assert client.delete(f"/api/jobs/{jid}", headers=h).status_code == 204
    assert client.get(f"/api/jobs/{jid}", headers=h).status_code == 404


def test_format_conflict_warning(client, tmp_path):
    t = tok()
    h = {"X-Client-Token": t}
    jid = upload(client, t, tmp_path).json()["id"]
    client.post(f"/api/jobs/{jid}/analyze", headers=h)
    client.post(f"/api/jobs/{jid}/generate", headers=h, json={"format_pref": "pdf"})
    job = client.get(f"/api/jobs/{jid}", headers=h).json()
    assert any("El profesor pide" in w for w in job["versions"][0]["warnings"])


def test_other_users_cannot_access(client, tmp_path):
    a, b = tok(), tok()
    jid = upload(client, a, tmp_path).json()["id"]
    hb = {"X-Client-Token": b}
    assert client.get(f"/api/jobs/{jid}", headers=hb).status_code == 404
    assert client.post(f"/api/jobs/{jid}/analyze", headers=hb).status_code == 404
    assert client.get("/api/jobs", headers=hb).json() == []
    assert client.get(f"/api/jobs/{jid}").status_code == 401  # sin token
    assert client.get("/api/jobs/../../etc", headers=hb).status_code in (404, 405)


def test_upload_validation(client, tmp_path):
    t = tok()
    h = {"X-Client-Token": t}
    r = client.post("/api/jobs", headers=h, files=[("files", ("virus.exe", b"MZ", "application/octet-stream"))], data={"student_name": "A"})
    assert r.status_code == 422 and "no admitido" in r.json()["detail"]
    r = client.post("/api/jobs", headers=h, files=[("files", ("x.docx", b"%PDF", "application/octet-stream"))], data={"student_name": "A"})
    assert r.status_code == 422
    r = client.post("/api/jobs", headers=h, files=[("files", ("a.txt", b"hola", "text/plain"))], data={"student_name": "  "})
    assert r.status_code == 422


def test_injection_flags_exposed(client, tmp_path):
    t = tok()
    m = fx.make_malicious_docx(tmp_path / "m.docx")
    job = upload(client, t, tmp_path, [("files", ("m.docx", m.read_bytes(), "application/octet-stream"))]).json()
    assert any(f["source"] == "m.docx" for f in job["security_flags"])


def test_rate_limit(client, tmp_path):
    old = settings.jobs_per_day
    settings.jobs_per_day = 2
    try:
        t = tok()
        assert upload(client, t, tmp_path).status_code == 201
        assert upload(client, t, tmp_path).status_code == 201
        r = upload(client, t, tmp_path)
        assert r.status_code == 429 and "Retry-After" in r.headers
    finally:
        settings.jobs_per_day = old


def test_without_api_key_ai_is_refused(client, tmp_path):
    settings.anthropic_api_key = None
    t = tok()
    jid = upload(client, t, tmp_path).json()["id"]
    r = client.post(f"/api/jobs/{jid}/analyze", headers={"X-Client-Token": t})
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert client.get("/api/health").json()["ai_configured"] is False


def test_cleanup_expired(client, tmp_path):
    t = tok()
    jid = upload(client, t, tmp_path).json()["id"]
    storage.update_job(jid, lambda j: j.update(created_ts=0))
    assert storage.cleanup_expired() >= 1
    assert storage.load_job(jid) is None
