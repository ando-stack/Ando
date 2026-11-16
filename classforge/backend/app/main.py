"""API HTTP de ClassForge AI (FastAPI)."""
from __future__ import annotations

import io
import logging
import threading
import time
import zipfile
from contextlib import asynccontextmanager
from datetime import date as dt_date
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import pipeline, storage
from .config import settings
from .convert import soffice
from .preview import render_preview
from .security import FileRejected, client_token, hash_token, limit_ai, limit_jobs, owns, validate_upload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("classforge")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.jobs_dir.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=_cleanup_loop, daemon=True, name="cleanup").start()
    yield


app = FastAPI(title="ClassForge AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["X-Client-Token", "Content-Type"], expose_headers=["Content-Disposition"])

FORMAT_PREFS = Literal["auto", "docx", "xlsx", "pptx", "pdf", "csv"]
BUSY = {"analyzing", "generating"}


# --------------------------------------------------------------------------- #
# Limpieza periódica de archivos temporales
# --------------------------------------------------------------------------- #
def _cleanup_loop() -> None:
    while True:
        try:
            n = storage.cleanup_expired()
            if n:
                log.info("Limpieza: %d trabajo(s) caducado(s) eliminados", n)
        except Exception:  # noqa: BLE001
            log.exception("Error en la limpieza")
        time.sleep(settings.cleanup_interval_s)




# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def get_owned_job(job_id: str, token: str) -> dict:
    job = storage.load_job(job_id)
    # Mismo error si no existe o si es de otro: no revelamos la existencia de trabajos ajenos.
    if job is None or not owns(job, token):
        raise HTTPException(404, "Trabajo no encontrado.")
    return job


def public_job(job: dict) -> dict:
    j = {k: v for k, v in job.items() if k not in ("owner_hash", "created_ts")}
    j["files"] = [{k: v for k, v in f.items() if k != "stored_name"} for f in job["files"]]
    vers = []
    for v in job["versions"]:
        v2 = dict(v)
        v2["outputs"] = [{k: x for k, x in o.items() if k not in ("stored", "recalculated")} for o in v["outputs"]]
        val = dict(v["validation"])
        val["deliverables"] = [{k: x for k, x in d.items() if k != "recalculated"} for d in val["deliverables"]]
        v2["validation"] = val
        vers.append(v2)
    j["versions"] = vers
    j["expires_at_ts"] = job.get("created_ts", 0) + settings.retention_hours * 3600
    return j


def _find_file(job: dict, file_id: str) -> tuple[Path, str, str, Path | None]:
    jd = storage.job_dir(job["id"])
    for f in job["files"]:
        if f["id"] == file_id:
            return jd / "inputs" / f["stored_name"], f["name"], f["kind"], None
    for v in job["versions"]:
        for o in v["outputs"]:
            if o["id"] == file_id:
                rec = jd / o["recalculated"] if o.get("recalculated") else None
                return jd / o["stored"], o["name"], o["format"], rec
    raise HTTPException(404, "Archivo no encontrado.")


MIME = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf", "csv": "text/csv", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "txt": "text/plain", "md": "text/plain",
}


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "ai_configured": settings.ai_configured,
        "model": settings.model,
        "formula_engine": bool(soffice()),
        "pdf_conversion": bool(soffice()),
        "limits": {"max_file_mb": settings.max_file_mb, "max_total_mb": settings.max_total_mb, "max_files": settings.max_files,
                   "retention_hours": settings.retention_hours, "jobs_per_day": settings.jobs_per_day},
        "formats": {"input": ["docx", "xlsx", "pptx", "pdf", "csv", "txt", "md", "png", "jpg"], "output": ["docx", "xlsx", "pptx", "pdf", "csv"]},
    }


@app.post("/api/jobs", status_code=201)
async def create_job(request: Request, files: list[UploadFile] = File(...), student_name: str = Form(...),
                     date: str = Form(""), extra_notes: str = Form(""), token: str = Depends(client_token)) -> dict:
    student_name = student_name.strip()[:120]
    if not student_name:
        raise HTTPException(422, "Indica tu nombre.")
    date = (date.strip() or dt_date.today().strftime("%d/%m/%Y"))[:40]
    if not files:
        raise HTTPException(422, "Sube al menos un archivo.")
    if len(files) > settings.max_files:
        raise HTTPException(422, f"Máximo {settings.max_files} archivos por trabajo.")
    limit_jobs(token, request)

    blobs, total, errors = [], 0, []
    for uf in files:
        data = await uf.read(settings.max_file_mb * 1024 * 1024 + 1)
        total += len(data)
        name = storage.safe_filename(uf.filename or "archivo")
        try:
            kind = validate_upload(name, data)
            blobs.append((name, kind, data))
        except FileRejected as e:
            errors.append(str(e))
    if total > settings.max_total_mb * 1024 * 1024:
        raise HTTPException(413, f"El total supera {settings.max_total_mb} MB.")
    if errors:
        raise HTTPException(422, " ".join(errors))

    job = storage.create_job({
        "owner_hash": hash_token(token), "student_name": student_name, "date": date, "extra_notes": extra_notes.strip()[:2000],
        "title": blobs[0][0].rsplit(".", 1)[0], "progress": pipeline.initial_progress(),
    })
    d = storage.job_dir(job["id"]) / "inputs"
    metas = []
    for name, kind, data in blobs:
        fid = storage.new_file_id()
        ext = name.rsplit(".", 1)[-1].lower()
        stored = f"{fid}.{ext}"
        (d / stored).write_bytes(data)
        metas.append({"id": fid, "name": name, "kind": kind, "ext": ext, "size": len(data), "stored_name": stored})
    storage.update_job(job["id"], lambda j: j.update(files=metas))
    pipeline.run_ingest(job["id"])
    return public_job(storage.load_job(job["id"]))


@app.get("/api/jobs")
def list_jobs(token: str = Depends(client_token)) -> list[dict]:
    h = hash_token(token)
    jobs = [j for j in storage.list_jobs() if j.get("owner_hash") == h]
    jobs.sort(key=lambda j: j.get("created_ts", 0), reverse=True)
    return [{"id": j["id"], "title": j.get("title"), "status": j["status"], "created_at": j["created_at"], "student_name": j["student_name"],
             "files": len(j["files"]), "versions": len(j["versions"]), "subject": (j.get("analysis") or {}).get("subject"),
             "expires_at_ts": j.get("created_ts", 0) + settings.retention_hours * 3600} for j in jobs]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, token: str = Depends(client_token)) -> dict:
    return public_job(get_owned_job(job_id, token))


@app.delete("/api/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, token: str = Depends(client_token)) -> None:
    get_owned_job(job_id, token)
    storage.delete_job(job_id)


def _require_ai() -> None:
    if not settings.ai_configured:
        raise HTTPException(503, "La IA no está configurada en el servidor (falta ANTHROPIC_API_KEY). No es posible analizar documentos.")


@app.post("/api/jobs/{job_id}/analyze", status_code=202)
def analyze(job_id: str, request: Request, bg: BackgroundTasks, token: str = Depends(client_token)) -> dict:
    job = get_owned_job(job_id, token)
    _require_ai()
    if job["status"] in BUSY:
        raise HTTPException(409, "El trabajo ya se está procesando.")
    if job["progress"][0]["status"] != "done":
        raise HTTPException(409, "Los documentos no se pudieron leer.")
    limit_ai(token, request)
    pipeline.reset_stages(job_id, ["interpret", "plan", "execute", "validate", "deliver"])
    storage.update_job(job_id, lambda j: j.update(status="analyzing", error=None))
    bg.add_task(pipeline.run_analysis, job_id)
    return public_job(storage.load_job(job_id))


class GenerateBody(BaseModel):
    format_pref: FORMAT_PREFS = "auto"
    extra_notes: str = Field("", max_length=2000)


@app.post("/api/jobs/{job_id}/generate", status_code=202)
def generate(job_id: str, body: GenerateBody, request: Request, bg: BackgroundTasks, token: str = Depends(client_token)) -> dict:
    job = get_owned_job(job_id, token)
    _require_ai()
    if job["status"] in BUSY:
        raise HTTPException(409, "El trabajo ya se está procesando.")
    if not job.get("analysis"):
        raise HTTPException(409, "Primero hay que analizar los documentos.")
    limit_ai(token, request)
    pipeline.reset_stages(job_id, ["plan", "execute", "validate", "deliver"])
    storage.update_job(job_id, lambda j: j.update(status="generating", error=None, format_pref=body.format_pref))
    bg.add_task(pipeline.run_generation, job_id, body.format_pref, body.extra_notes)
    return public_job(storage.load_job(job_id))


class ReviseBody(BaseModel):
    feedback: str = Field(..., min_length=3, max_length=3000)
    format_pref: Optional[FORMAT_PREFS] = None


@app.post("/api/jobs/{job_id}/revise", status_code=202)
def revise(job_id: str, body: ReviseBody, request: Request, bg: BackgroundTasks, token: str = Depends(client_token)) -> dict:
    job = get_owned_job(job_id, token)
    _require_ai()
    if job["status"] in BUSY:
        raise HTTPException(409, "El trabajo ya se está procesando.")
    if not job["versions"]:
        raise HTTPException(409, "Todavía no hay ninguna versión que corregir.")
    limit_ai(token, request)
    fmt = body.format_pref or job.get("format_pref") or "auto"
    pipeline.reset_stages(job_id, ["plan", "execute", "validate", "deliver"])
    storage.update_job(job_id, lambda j: j.update(status="generating", error=None))
    bg.add_task(pipeline.run_generation, job_id, fmt, "", body.feedback)
    return public_job(storage.load_job(job_id))


@app.get("/api/jobs/{job_id}/files/{file_id}")
def download(job_id: str, file_id: str, token: str = Depends(client_token)):
    job = get_owned_job(job_id, token)
    path, name, kind, _ = _find_file(job, file_id)
    if not path.exists():
        raise HTTPException(410, "El archivo ya no está disponible.")
    ext = name.rsplit(".", 1)[-1].lower()
    return FileResponse(path, media_type=MIME.get(ext, "application/octet-stream"), filename=name)


@app.get("/api/jobs/{job_id}/files/{file_id}/preview", response_class=HTMLResponse)
def preview(job_id: str, file_id: str, token: str = Depends(client_token)):
    job = get_owned_job(job_id, token)
    path, name, kind, rec = _find_file(job, file_id)
    if not path.exists():
        raise HTTPException(410, "El archivo ya no está disponible.")
    html = render_preview(path, kind, rec)
    return HTMLResponse(html, headers={"Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff"})


@app.get("/api/jobs/{job_id}/versions/{version}/zip")
def download_zip(job_id: str, version: int, with_steps: bool = False, token: str = Depends(client_token)):
    job = get_owned_job(job_id, token)
    v = next((x for x in job["versions"] if x["version"] == version), None)
    if v is None:
        raise HTTPException(404, "Versión no encontrada.")
    jd = storage.job_dir(job_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for o in v["outputs"]:
            p = jd / o["stored"]
            if p.exists():
                zf.write(p, o["name"])
        if with_steps:
            zf.writestr("Procedimiento_paso_a_paso.md", steps_markdown(job, v))
    buf.seek(0)
    base = storage.safe_filename(f"{job['student_name']}_{job.get('title') or 'trabajo'}_v{version}")
    ascii_name = base.encode("ascii", "ignore").decode() or "trabajo"
    disp = f"attachment; filename=\"{ascii_name}.zip\"; filename*=UTF-8''{quote(base)}.zip"
    return StreamingResponse(buf, media_type="application/zip", headers={"Content-Disposition": disp})


def steps_markdown(job: dict, v: dict) -> str:
    lines = [f"# Procedimiento — {job.get('title')}", f"Alumno: {job['student_name']} · Fecha: {job['date']} · Versión {v['version']}", ""]
    for d in v["deliverables"]:
        lines.append(f"## {d['filename']}")
        lines.append(d.get("purpose") or "")
        for s in d["steps"]:
            mark = "✔" if s["status"] == "ok" else "✘"
            lines.append(f"{s['n']}. {mark} {s['explanation']}" + (f"  \n   _Resultado:_ {s['message']}" if s["message"] else ""))
        lines.append("")
    return "\n".join(lines)
