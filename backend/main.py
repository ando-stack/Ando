"""API (FastAPI) y gestión de tareas en segundo plano.

Arranque:  cd backend && uvicorn main:app --port 8000   (o python main.py)
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ai_editor  # noqa: E402
import audio  # noqa: E402
import autoedit  # noqa: E402
import chat  # noqa: E402
import color  # noqa: E402
import faces  # noqa: E402
import ingest  # noqa: E402
import jobs  # noqa: E402
import project_ops as ops  # noqa: E402
import render  # noqa: E402
import schema  # noqa: E402
from config import (ANTHROPIC_MODEL, ASSETS_DIR, FRONTEND_DIR, HOST, PORT, PROJECTS_DIR,
                    VIDEO_EXTENSIONS, ai_available)
from utils import new_id  # noqa: E402

app = FastAPI(title="Editor de vídeo con IA")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


@app.exception_handler(schema.ProjectInvalid)
async def invalid_handler(_req: Request, exc: schema.ProjectInvalid):
    return JSONResponse(status_code=422, content={"detail": f"Cambio rechazado: el proyecto quedaría inválido ({exc})"})


def _project_or_404(name: str) -> Path:
    try:
        d = ops.project_dir(name)
    except ValueError:
        raise HTTPException(400, "Nombre no válido")
    if not (d / "project.json").exists():
        raise HTTPException(404, f"No existe el proyecto {name}")
    return d


def _safe_file(base: Path, rel: str) -> Path:
    f = (base / rel).resolve()
    if base.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "Archivo no encontrado")
    return f


# ====================================================================== estado general
@app.get("/api/status")
def status():
    ff = shutil.which("ffmpeg") is not None
    return {"ai": ai_available(), "model": ANTHROPIC_MODEL if ai_available() else None, "ffmpeg": ff,
            "node": shutil.which("node") is not None,
            "message": None if ai_available() else
            "Sin clave de API de Anthropic: el chat y las decisiones creativas (títulos, emojis, zooms suaves y "
            "transiciones) no están disponibles. El resto funciona: silencios, subtítulos, color y edición manual."}


@app.get("/api/library")
def library():
    return {"emojis": ai_editor.emoji_catalog(), "music": audio.list_library("music"), "sfx": audio.list_library("sfx"),
            "fonts": ["Montserrat", "Anton", "BebasNeue", "Poppins", "Inter"],
            "captionPresets": ["clasico", "tiktok", "neon", "minimal", "karaoke"]}


@app.get("/api/schema")
def project_schema():
    return schema.project_json_schema()


# ====================================================================== importación (fase 1)
@app.post("/api/imports")
def create_import(body: dict = Body(default={})):
    name = (body.get("name") or "mi-video").strip()
    return {"importId": ingest.new_import(name)}


@app.post("/api/imports/{import_id}/files")
async def upload_file(import_id: str, file: UploadFile = File(...)):
    d = ingest.import_dir(import_id)
    if not d.exists():
        raise HTTPException(404, "Importación no encontrada")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(400, f"Formato no admitido ({ext}). Usa .mp4, .mov, .mkv o .webm")
    cid = new_id("clip")
    dst = d / "originales" / f"{cid}{ext}"
    with dst.open("wb") as f:
        while chunk := await file.read(4 * 1024 * 1024):
            f.write(chunk)
    try:
        meta = ingest.probe(dst)
    except Exception as e:  # noqa: BLE001
        dst.unlink(missing_ok=True)
        raise HTTPException(400, f"No se puede leer {file.filename}: {e}")
    data = ingest.load_import(import_id)
    data["clips"].append({"id": cid, "name": file.filename, "original": f"originales/{cid}{ext}", **meta})
    ingest.save_import(import_id, data)
    return {"id": cid, "name": file.filename, **meta}


@app.post("/api/imports/{import_id}/analyze")
def analyze_import(import_id: str, body: dict = Body(default={})):
    lang = body.get("language", "es")
    codec = body.get("proxyCodec", "h264")
    job = jobs.start("importar", None, "Analizando clips",
                     lambda j: ingest.analyze_import(import_id, j, None if lang == "auto" else lang, ai_available(), codec))
    return job.to_dict()


@app.get("/api/imports/{import_id}")
def get_import(import_id: str):
    data = ingest.load_import(import_id)
    for c in data["clips"]:
        c.pop("words", None)
        c.pop("firstFrame", None)
        c.pop("lastFrame", None)
    return data


@app.post("/api/imports/{import_id}/confirm")
def confirm_import(import_id: str, body: dict = Body(...)):
    groups = body.get("groups") or []
    if not groups or not any(groups):
        raise HTTPException(400, "No hay grupos")
    names = ingest.create_projects(import_id, [g for g in groups if g], body.get("names"))
    return {"projects": names}


@app.get("/import-files/{import_id}/{path:path}")
def import_file(import_id: str, path: str):
    return FileResponse(_safe_file(ingest.import_dir(import_id), path))


# ====================================================================== proyectos
@app.get("/api/projects")
def projects():
    return ops.list_projects()


@app.get("/api/projects/{name}")
def get_project(name: str):
    _project_or_404(name)
    return ops.load_dict(name)


@app.put("/api/projects/{name}")
def put_project(name: str, body: dict = Body(...)):
    _project_or_404(name)
    saved = ops.save(name, body)   # valida; si no es válido -> 422 con la explicación
    d = ops.project_dir(name)
    lut = saved.color.lutFile
    if lut and saved.color.enabled and (d / lut).exists():   # lut.cube = versión en uso (p. ej. tras deshacer)
        cur = d / "lut.cube"
        if not cur.exists() or cur.read_bytes() != (d / lut).read_bytes():
            shutil.copy(d / lut, cur)
    return {"ok": True, "updatedAt": saved.updatedAt}


@app.get("/files/{name}/{path:path}")
def project_file(name: str, path: str):
    return FileResponse(_safe_file(_project_or_404(name), path))


@app.get("/api/projects/{name}/waveform/{source_id}")
def waveform(name: str, source_id: str):
    import numpy as np
    import transcribe
    d = _project_or_404(name)
    cache = d / "cache" / f"wave_{source_id}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    wav = d / "audio" / f"{source_id}.wav"
    if not wav.exists():
        raise HTTPException(404, "Sin audio")
    x = np.abs(transcribe.load_wav(wav))
    per = 160  # 100 valores por segundo a 16 kHz
    n = len(x) // per
    peaks = x[: n * per].reshape(n, per).max(1) if n else np.zeros(0)
    m = float(peaks.max()) if n else 1.0
    data = {"rate": 100, "peaks": [round(float(v / (m or 1)), 3) for v in peaks]}
    cache.write_text(json.dumps(data))
    return data


@app.get("/api/projects/{name}/srt", response_class=PlainTextResponse)
def srt(name: str):
    _project_or_404(name)
    return render.to_srt(ops.load_dict(name))


@app.get("/api/projects/{name}/download/{path:path}")
def download(name: str, path: str):
    f = _safe_file(_project_or_404(name), path)
    return FileResponse(f, filename=f.name)


# ---------------------------------------------------------------------- edición automática
@app.post("/api/projects/{name}/autoedit")
def run_autoedit(name: str, body: dict = Body(default={})):
    d = _project_or_404(name)
    settings = schema.AutoEditSettings.model_validate({**ops.load_dict(name)["autoEdit"], **body}).model_dump()

    def work(job):
        p = ops.load_dict(name)
        p2, report = autoedit.run(d, p, settings, job)
        ops.save(name, p2)
        return report

    return jobs.start("autoedit", name, "Edición automática", work).to_dict()


# ---------------------------------------------------------------------- color
@app.post("/api/projects/{name}/color")
def apply_color(name: str, body: dict = Body(default={})):
    d = _project_or_404(name)

    def work(job):
        p = ops.load_dict(name)
        for k in ("enabled", "intensity", "temperature", "exposure", "contrast", "saturation"):
            if k in body:
                p["color"][k] = body[k]
        p = color.build_and_apply(d, p, job, force_analyze=bool(body.get("reanalyze")))
        latest = ops.load_dict(name)        # no pisar cambios hechos mientras tanto
        latest["color"] = p["color"]
        for s_new in p["sources"]:
            for s in latest["sources"]:
                if s["id"] == s_new["id"]:
                    s["corrected"], s["correctedProxy"] = s_new["corrected"], s_new["correctedProxy"]
        ops.save(name, latest)
        return {"color": p["color"]}

    return jobs.start("color", name, "Corrección de color", work).to_dict()


# ---------------------------------------------------------------------- caras
@app.post("/api/projects/{name}/faces/analyze")
def analyze_faces(name: str):
    d = _project_or_404(name)

    def work(job):
        p = faces.analyze_project(d, ops.load_dict(name), job)
        latest = ops.load_dict(name)
        latest["faces"] = p["faces"]
        ops.save(name, latest)
        return {"faces": len(p["faces"]["tracks"]), "unreliable": len(p["faces"]["unreliable"])}

    return jobs.start("caras", name, "Detección de caras", work).to_dict()


@app.post("/api/projects/{name}/faces/pixelate")
def pixelate(name: str, body: dict = Body(...)):
    """Crea los tramos de pixelado de las caras elegidas (solo bajo petición del usuario)."""
    _project_or_404(name)
    p = ops.load_dict(name)
    ids = body.get("faceIds") or []
    for fid in ids:
        p["faces"]["pixelate"] = [x for x in p["faces"]["pixelate"] if x["faceId"] != fid]
        p["faces"]["pixelate"] += faces.default_pixelate_items(p, fid, body.get("mode", "pixelate"),
                                                               body.get("intensity", 0.75), body.get("margin", 0.35))
    p["tracks"]["pixelado"]["enabled"] = True
    return ops.save(name, p).model_dump(mode="json")


@app.post("/api/projects/{name}/faces/verify")
def verify_faces(name: str):
    d = _project_or_404(name)

    def work(job):
        job.update(0.1, "Verificando el pixelado en varios fotogramas")
        res = faces.verify(d, ops.load_dict(name))
        latest = ops.load_dict(name)
        latest["faces"]["verification"] = res
        ops.save(name, latest)
        return {"results": res, "image": "cache/faces/verificacion.jpg"}

    return jobs.start("verificar", name, "Verificación del pixelado", work).to_dict()


@app.post("/api/projects/{name}/reframe")
def reframe(name: str):
    d = _project_or_404(name)

    def work(job):
        p = render.compute_reframe(d, ops.load_dict(name), job)
        latest = ops.load_dict(name)
        latest["reframe"]["parts"] = p["reframe"]["parts"]
        latest["faces"] = p["faces"]
        ops.save(name, latest)
        return {"ok": True}

    return jobs.start("reencuadre", name, "Reencuadre vertical", work).to_dict()


# ---------------------------------------------------------------------- chat
@app.post("/api/projects/{name}/chat")
def chat_message(name: str, body: dict = Body(...)):
    d = _project_or_404(name)
    msg = (body.get("message") or "").strip()
    if not msg:
        raise HTTPException(400, "Mensaje vacío")
    if not ai_available():
        raise HTTPException(503, "El chat necesita una clave de API de Anthropic (ANTHROPIC_API_KEY en .env).")
    p = ops.load_dict(name)
    try:
        res = chat.run_chat(d, p, msg)
    except ai_editor.AIUnavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Error al hablar con la IA: {e}")
    saved = ops.save(name, res["project"]).model_dump(mode="json")
    job = None
    if res["needsColor"]:
        job = apply_color(name, {})
    return {"project": saved, "reply": res["reply"], "changes": res["changes"], "colorJob": job}


# ---------------------------------------------------------------------- exportación
@app.get("/api/projects/{name}/presets")
def presets(name: str):
    _project_or_404(name)
    return render.available_presets(ops.load_dict(name))


@app.post("/api/projects/{name}/export")
def export(name: str, body: dict = Body(...)):
    _project_or_404(name)
    preset = body.get("preset", "16x9-1080")
    if preset not in render.PRESETS:
        raise HTTPException(400, "Preset desconocido")
    return jobs.start("exportar", name, f"Exportando {render.PRESETS[preset]['label']}",
                      lambda j: render.export(name, preset, j)).to_dict()


@app.get("/api/projects/{name}/exports")
def exports(name: str):
    _project_or_404(name)
    return render.list_exports(name)


# ====================================================================== tareas
@app.get("/api/jobs")
def list_jobs(project: Optional[str] = None):
    return jobs.list_jobs(project)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "Tarea no encontrada")
    return j.to_dict()


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    if not jobs.cancel(job_id):
        raise HTTPException(404, "Tarea no encontrada")
    return {"ok": True}


# ====================================================================== estáticos
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
_dist = FRONTEND_DIR / "dist"
if _dist.exists():
    app.mount("/app", StaticFiles(directory=_dist, html=True), name="app")

    @app.get("/")
    def root():
        return RedirectResponse("/app/")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
