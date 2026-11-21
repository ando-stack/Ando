from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..analysis.engine import rescore
from ..analysis.schemas import CATEGORIES, ERROR_TYPES, SEVERITIES
from ..db import get_db
from ..models import Analysis, CoachNote, Finding, Frame, PlayerGoal, User, log_activity
from ..security import current_user
from .common import current_analysis, finding_dict_for_score, finding_out, get_match, iso

router = APIRouter(tags=["analysis"])


def _findings(db, match_id: str, analysis: Analysis | None) -> list[Finding]:
    cond = Finding.origin == "coach"
    if analysis:
        cond = or_(Finding.analysis_id == analysis.id, cond)
    return db.scalars(select(Finding).where(Finding.match_id == match_id, cond).order_by(Finding.t_start)).all()


def _rescore(db, match_id: str) -> None:
    a = current_analysis(db, match_id)
    if not a or not a.scores:
        return
    a.scores = rescore(a.scores, [finding_dict_for_score(f) for f in _findings(db, match_id, a)])


def note_out(n: CoachNote) -> dict:
    return {"id": n.id, "t": n.t, "category": n.category, "text": n.text, "created_at": iso(n.created_at), "updated_at": iso(n.updated_at)}


@router.get("/matches/{match_id}/analysis")
def get_analysis(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    a = current_analysis(db, m.id)
    notes = db.scalars(select(CoachNote).where(CoachNote.match_id == m.id).order_by(CoachNote.t.is_(None), CoachNote.t, CoachNote.created_at)).all()
    findings = _findings(db, m.id, a)
    if not a:
        return {"analysis": None, "findings": [finding_out(f) for f in findings], "notes": [note_out(n) for n in notes]}
    frames = db.scalars(select(Frame).where(Frame.analysis_id == a.id).order_by(Frame.t)).all()
    return {
        "analysis": {
            "id": a.id, "source_type": a.source_type, "model": a.model, "pipeline_version": a.pipeline_version,
            "created_at": iso(a.created_at), "coverage": a.coverage, "stats": a.stats, "scores": a.scores,
            "report": a.report, "timeline": a.timeline, "replay_data": a.replay_data, "usage": a.usage,
        },
        "frames": [{"label": f.label, "t": f.t, "reason": f.reason, "segment": f.segment_index} for f in frames],
        "findings": [finding_out(f) for f in findings],
        "notes": [note_out(n) for n in notes],
    }


class FindingPatch(BaseModel):
    review_status: str | None = Field(default=None, pattern="^(open|confirmed|dismissed)$")
    severity: str | None = Field(default=None, pattern="^(low|medium|high|critical)$")
    title: str | None = Field(default=None, max_length=200)
    what_to_do: str | None = Field(default=None, max_length=5000)
    how_to_avoid: str | None = Field(default=None, max_length=5000)


class FindingIn(BaseModel):
    t_start: float = Field(ge=0)
    t_end: float | None = Field(default=None, ge=0)
    category: str
    error_type: str | None = None
    severity: str
    title: str = Field(min_length=1, max_length=200)
    what_happened: str = Field(min_length=1, max_length=5000)
    why_error: str | None = Field(default=None, max_length=5000)
    what_to_do: str | None = Field(default=None, max_length=5000)
    how_to_avoid: str | None = Field(default=None, max_length=5000)


def _own_finding(db, user, finding_id) -> Finding:
    f = db.get(Finding, finding_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Marcador no encontrado")
    return f


@router.post("/matches/{match_id}/findings")
def add_finding(match_id: str, body: FindingIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    if body.category not in CATEGORIES or body.severity not in SEVERITIES or (body.error_type and body.error_type not in ERROR_TYPES):
        raise HTTPException(422, "Categoría, tipo o gravedad no válidos")
    a = current_analysis(db, m.id)
    phase = None
    if a and a.timeline:
        frames = [x for x in a.timeline if x.get("kind") == "frame" and x.get("phase")]
        near = min(frames, key=lambda x: abs(x["t"] - body.t_start), default=None)
        phase = near["phase"] if near else None
    f = Finding(owner_id=user.id, match_id=m.id, analysis_id=None, origin="coach", module="coach", phase=phase, confidence=1.0,
                review_status="confirmed", evidence=[{"id": "coach", "t": body.t_start, "kind": "coach"}], **body.model_dump())
    db.add(f)
    db.flush()
    _rescore(db, m.id)
    db.commit()
    return finding_out(f)


@router.patch("/findings/{finding_id}")
def patch_finding(finding_id: str, body: FindingPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    f = _own_finding(db, user, finding_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.flush()
    _rescore(db, f.match_id)
    db.commit()
    return finding_out(f)


@router.delete("/findings/{finding_id}")
def delete_finding(finding_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    f = _own_finding(db, user, finding_id)
    if f.origin != "coach":
        raise HTTPException(400, "Los hallazgos automáticos no se borran: márcalos como descartados")
    mid = f.match_id
    db.delete(f)
    db.flush()
    _rescore(db, mid)
    db.commit()
    return {"ok": True}


class NoteIn(BaseModel):
    t: float | None = Field(default=None, ge=0)
    category: str | None = Field(default=None, max_length=30)
    text: str = Field(min_length=1, max_length=10000)


@router.post("/matches/{match_id}/notes")
def add_note(match_id: str, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    n = CoachNote(owner_id=user.id, match_id=m.id, **body.model_dump())
    db.add(n)
    db.commit()
    return note_out(n)


@router.patch("/notes/{note_id}")
def edit_note(note_id: str, body: NoteIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(CoachNote, note_id)
    if not n or n.owner_id != user.id:
        raise HTTPException(404, "Nota no encontrada")
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    db.commit()
    return note_out(n)


@router.delete("/notes/{note_id}")
def delete_note(note_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(CoachNote, note_id)
    if not n or n.owner_id != user.id:
        raise HTTPException(404, "Nota no encontrada")
    db.delete(n)
    db.commit()
    return {"ok": True}


@router.post("/matches/{match_id}/goals-from-report")
def goals_from_report(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_match(db, user.id, match_id)
    a = current_analysis(db, m.id)
    if not a:
        raise HTTPException(400, "La partida no tiene análisis")
    existing = {g.title for g in db.scalars(select(PlayerGoal).where(PlayerGoal.source_analysis_id == a.id))}
    created = 0
    for g in (a.report or {}).get("next_session_goals", []):
        if g["title"] in existing:
            continue
        db.add(PlayerGoal(owner_id=user.id, player_id=m.player_id, title=g["title"][:200], description=g.get("measurable_target"),
                          category=g.get("category"), source_analysis_id=a.id))
        created += 1
    if created:
        log_activity(db, user.id, "goals_imported", f"{created} objetivos añadidos desde el informe de {m.title}", match_id=m.id, player_id=m.player_id)
    db.commit()
    return {"created": created}


@router.get("/matches/{match_id}/report.pdf")
def report_pdf(match_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..analysis.pdf import render_report_pdf

    m = get_match(db, user.id, match_id)
    a = current_analysis(db, m.id)
    if not a:
        raise HTTPException(400, "La partida no tiene análisis")
    notes = db.scalars(select(CoachNote).where(CoachNote.match_id == m.id).order_by(CoachNote.t)).all()
    pdf = render_report_pdf(m, a, [finding_out(f) for f in _findings(db, m.id, a)], [note_out(n) for n in notes])
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in m.title)[:60] or "informe"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
