from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Analysis, Finding, Match, Player, PlayerGoal, User, log_activity, utcnow
from ..security import current_user
from ..storage import get_storage
from .common import finding_out, get_match, get_player, iso, match_out, player_out

router = APIRouter(prefix="/players", tags=["players"])

PLATFORMS = {"PC", "PlayStation", "Xbox", "Switch", "Mobile", "Otra"}


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    epic_id: str | None = Field(default=None, max_length=120)
    platform: str | None = Field(default=None, max_length=40)
    region: str | None = Field(default=None, max_length=40)
    game_mode: str | None = Field(default=None, max_length=60)
    competitive_level: str | None = Field(default=None, max_length=60)
    coach_notes: str | None = Field(default=None, max_length=20000)


class PlayerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    epic_id: str | None = Field(default=None, max_length=120)
    platform: str | None = Field(default=None, max_length=40)
    region: str | None = Field(default=None, max_length=40)
    game_mode: str | None = Field(default=None, max_length=60)
    competitive_level: str | None = Field(default=None, max_length=60)
    coach_notes: str | None = Field(default=None, max_length=20000)


@router.get("")
def list_players(db: Session = Depends(get_db), user: User = Depends(current_user)):
    players = db.scalars(select(Player).where(Player.owner_id == user.id).order_by(Player.name)).all()
    counts = dict(db.execute(select(Match.player_id, func.count(Match.id)).where(Match.owner_id == user.id).group_by(Match.player_id)).all())
    out = []
    for p in players:
        last = db.scalar(
            select(Analysis).join(Match, Match.id == Analysis.match_id)
            .where(Match.player_id == p.id, Analysis.is_current.is_(True)).order_by(Analysis.created_at.desc())
        )
        out.append({**player_out(p), "matches": counts.get(p.id, 0), "last_score": (last.scores or {}).get("overall") if last else None,
                    "last_analysis_at": iso(last.created_at) if last else None})
    return out


@router.post("")
def create_player(body: PlayerIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = Player(owner_id=user.id, **body.model_dump())
    db.add(p)
    db.flush()
    log_activity(db, user.id, "player_created", f"Nuevo jugador: {p.name}", player_id=p.id)
    db.commit()
    return player_out(p)


@router.get("/{player_id}")
def get_player_detail(player_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    matches = db.scalars(select(Match).where(Match.player_id == p.id).order_by(Match.created_at.desc())).all()
    analyses = db.scalars(
        select(Analysis).join(Match, Match.id == Analysis.match_id)
        .where(Match.player_id == p.id, Analysis.is_current.is_(True)).order_by(Analysis.created_at)
    ).all()
    by_match = {a.match_id: a for a in analyses}
    evolution = []
    for a in analyses:
        m = next((x for x in matches if x.id == a.match_id), None)
        cats = {k: v.get("score") for k, v in (a.scores or {}).get("categories", {}).items()}
        evolution.append({"analysis_id": a.id, "match_id": a.match_id, "title": m.title if m else "", "date": iso((m.played_at if m and m.played_at else a.created_at)),
                          "overall": (a.scores or {}).get("overall"), "categories": cats, "source_type": a.source_type})
    # recurring problems: categories/error types over current analyses, excluding dismissed
    rows = []
    if matches:
        rows = db.execute(
            select(Finding.category, Finding.severity, func.count(Finding.id)).where(
                Finding.review_status != "dismissed",
                or_(Finding.analysis_id.in_([a.id for a in analyses]),
                    and_(Finding.origin == "coach", Finding.match_id.in_([m.id for m in matches]))),
            ).group_by(Finding.category, Finding.severity)
        ).all()
    recurring: dict[str, dict] = {}
    for cat, sev, n in rows:
        r = recurring.setdefault(cat, {"category": cat, "count": 0, "by_severity": {}})
        r["count"] += n
        r["by_severity"][sev] = n
    goals = db.scalars(select(PlayerGoal).where(PlayerGoal.player_id == p.id).order_by(PlayerGoal.created_at.desc())).all()
    return {
        **player_out(p),
        "matches": [match_out(m, analysis=by_match.get(m.id)) for m in matches],
        "evolution": evolution,
        "recurring_errors": sorted(recurring.values(), key=lambda r: -r["count"]),
        "goals": [goal_out(g) for g in goals],
    }


@router.patch("/{player_id}")
def update_player(player_id: str, body: PlayerPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return player_out(p)


@router.delete("/{player_id}")
def delete_player(player_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    st = get_storage()
    for m in db.scalars(select(Match).where(Match.player_id == p.id)):
        st.delete_prefix(f"{user.id}/{m.id}")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- goals
class GoalIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, max_length=40)
    due_date: dt.datetime | None = None
    source_analysis_id: str | None = None


class GoalPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, pattern="^(pending|achieved|dropped)$")
    due_date: dt.datetime | None = None


def goal_out(g: PlayerGoal) -> dict:
    return {"id": g.id, "player_id": g.player_id, "title": g.title, "description": g.description, "category": g.category,
            "status": g.status, "due_date": iso(g.due_date), "source_analysis_id": g.source_analysis_id,
            "created_at": iso(g.created_at), "completed_at": iso(g.completed_at)}


@router.post("/{player_id}/goals")
def create_goal(player_id: str, body: GoalIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    g = PlayerGoal(owner_id=user.id, player_id=p.id, **body.model_dump())
    db.add(g)
    log_activity(db, user.id, "goal_created", f"Objetivo para {p.name}: {g.title}", player_id=p.id)
    db.commit()
    return goal_out(g)


@router.patch("/{player_id}/goals/{goal_id}")
def update_goal(player_id: str, goal_id: str, body: GoalPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    g = db.get(PlayerGoal, goal_id)
    if not g or g.owner_id != user.id or g.player_id != player_id:
        raise HTTPException(404, "Objetivo no encontrado")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(g, k, v)
    if data.get("status") == "achieved":
        g.completed_at = utcnow()
        log_activity(db, user.id, "goal_achieved", f"Objetivo cumplido: {g.title}", player_id=player_id)
    db.commit()
    return goal_out(g)


@router.delete("/{player_id}/goals/{goal_id}")
def delete_goal(player_id: str, goal_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    g = db.get(PlayerGoal, goal_id)
    if not g or g.owner_id != user.id or g.player_id != player_id:
        raise HTTPException(404, "Objetivo no encontrado")
    db.delete(g)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- compare
@router.get("/{player_id}/compare")
def compare(player_id: str, a: str, b: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_player(db, user.id, player_id)
    out = []
    for mid in (a, b):
        m = get_match(db, user.id, mid)
        if m.player_id != p.id:
            raise HTTPException(400, "Ambas partidas deben ser del mismo jugador")
        an = db.scalar(select(Analysis).where(Analysis.match_id == m.id, Analysis.is_current.is_(True)))
        if not an:
            raise HTTPException(400, f"La partida '{m.title}' no tiene análisis")
        fs = db.scalars(select(Finding).where(Finding.analysis_id == an.id, Finding.review_status != "dismissed")).all()
        fs += db.scalars(select(Finding).where(Finding.match_id == m.id, Finding.origin == "coach")).all()
        by_cat: dict[str, int] = {}
        by_sev: dict[str, int] = {}
        for f in fs:
            by_cat[f.category] = by_cat.get(f.category, 0) + 1
            by_sev[f.severity] = by_sev.get(f.severity, 0) + 1
        out.append({
            "match": match_out(m), "analysis_id": an.id, "scores": an.scores, "stats": an.stats,
            "findings_by_category": by_cat, "findings_by_severity": by_sev, "findings_total": len(fs),
            "top_findings": [finding_out(f) for f in sorted(fs, key=lambda f: ["low", "medium", "high", "critical"].index(f.severity), reverse=True)[:5]],
        })
    deltas = {}
    ca, cb = out[0]["scores"].get("categories", {}), out[1]["scores"].get("categories", {})
    for k in set(ca) | set(cb):
        va, vb = (ca.get(k) or {}).get("score"), (cb.get(k) or {}).get("score")
        deltas[k] = None if va is None or vb is None else vb - va
    oa, ob = out[0]["scores"].get("overall"), out[1]["scores"].get("overall")
    return {"a": out[0], "b": out[1], "deltas": deltas, "overall_delta": None if oa is None or ob is None else ob - oa}
