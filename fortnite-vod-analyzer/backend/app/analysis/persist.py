from __future__ import annotations

from sqlalchemy import update

from ..db import session_scope
from ..models import Analysis, Finding, Match, log_activity


def save_analysis(analysis_id, match_id, owner_id, timeline, stats, scores, report, coverage, mod, usage, replay_data=None):
    with session_scope() as db:
        db.execute(update(Analysis).where(Analysis.match_id == match_id, Analysis.id != analysis_id).values(is_current=False))
        rows = []
        for f in mod["findings"]:
            row = Finding(owner_id=owner_id, match_id=match_id, analysis_id=analysis_id, origin="ai", **f)
            db.add(row)
            rows.append(row)
        db.flush()
        for te in report.get("top_errors", []):
            idx = te.pop("finding_index", None)
            if idx is not None and idx < len(rows):
                te["finding_id"] = rows[idx].id
        a = db.get(Analysis, analysis_id)
        a.timeline, a.stats, a.scores, a.report, a.coverage, a.usage = timeline, stats, scores, report, coverage, usage
        a.replay_data = replay_data
        a.is_current = True
        m = db.get(Match, match_id)
        m.status = "completed"
        log_activity(db, owner_id, "analysis_completed", f"Análisis completado: {m.title} ({len(rows)} errores)", match_id=match_id, player_id=m.player_id)
