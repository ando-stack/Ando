"""Professional PDF export of the coaching report (ReportLab, pure Python)."""
from __future__ import annotations

import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select

from ..db import session_scope
from ..models import Frame
from ..storage import get_storage
from .engine import fmt_t
from .schemas import CATEGORY_LABELS, ERROR_TYPE_LABELS

BLUE = colors.HexColor("#1f6fff")
INK = colors.HexColor("#0d1117")
MUTED = colors.HexColor("#5b6472")
LINE = colors.HexColor("#d8dde6")
SEV_COLORS = {"low": "#64748b", "medium": "#d4a017", "high": "#e8590c", "critical": "#e03131"}
SEV_LABEL = {"low": "Leve", "medium": "Media", "high": "Alta", "critical": "Crítica"}
PHASE_LABEL = {"early": "Early game", "mid": "Mid game", "end": "Endgame", None: "—"}


def _esc(s) -> str:
    return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _styles():
    ss = getSampleStyleSheet()
    base = ParagraphStyle("base", parent=ss["Normal"], fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK, alignment=TA_LEFT)
    return {
        "base": base,
        "muted": ParagraphStyle("muted", parent=base, textColor=MUTED, fontSize=8.5, leading=12),
        "h1": ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold", fontSize=20, leading=24, spaceAfter=4),
        "h2": ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=17, spaceBefore=12, spaceAfter=6, textColor=BLUE),
        "h3": ParagraphStyle("h3", parent=base, fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceBefore=6, spaceAfter=2),
        "small": ParagraphStyle("small", parent=base, fontSize=8, leading=11),
    }


def _bar(score):
    if score is None:
        return Paragraph("<font color='#5b6472'>sin datos</font>", _styles()["small"])
    t = Table([["", ""]], colWidths=[max(0.1, 60 * score / 100) * mm, max(0.1, 60 * (100 - score) / 100) * mm], rowHeights=[3.2 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), BLUE), ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#e9edf3")),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def render_report_pdf(match, analysis, findings: list[dict], notes: list[dict]) -> bytes:
    st = _styles()
    rep = analysis.report or {}
    scores = analysis.scores or {}
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"VOD Review — {match.title}", author="Fortnite VOD Analyzer")
    S: list = []
    P = lambda text, style="base": Paragraph(text, st[style])

    S.append(P("VOD REVIEW · INFORME DE COACHING", "muted"))
    S.append(P(_esc(match.title), "h1"))
    meta = f"Jugador: <b>{_esc(match.player.name)}</b> · Fuente: {'Vídeo' if analysis.source_type == 'video' else 'Replay'} · Modo: {_esc(match.game_mode or '—')} · Análisis: {analysis.created_at:%d/%m/%Y %H:%M}"
    S.append(P(meta, "muted"))
    S.append(Spacer(1, 6))

    # scores
    rows = [[P("<b>Puntuación global</b>"), P(f"<font size=16 color='#1f6fff'><b>{scores.get('overall') if scores.get('overall') is not None else '—'}</b></font> / 100"), ""]]
    for _k, c in (scores.get("categories") or {}).items():
        rows.append([P(_esc(c["label"])), P(str(c["score"]) if c["score"] is not None else "—"), _bar(c["score"])])
    t = Table(rows, colWidths=[60 * mm, 22 * mm, 64 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    S.append(t)
    S.append(P(_esc((scores.get("methodology") or {}).get("disclaimer", "")), "muted"))

    def section(title, text):
        if text:
            S.append(P(title, "h2"))
            S.append(P(_esc(text)))

    def bullets(title, items):
        if items:
            S.append(P(title, "h2"))
            for it in items:
                S.append(P("• " + _esc(it)))

    section("1. Resumen de la partida", rep.get("match_summary"))
    section("2. Evaluación general", rep.get("overall_evaluation"))
    bullets("3. Puntos fuertes", rep.get("strengths"))
    bullets("4. Puntos débiles", rep.get("weaknesses"))

    # top 5
    by_id = {f["id"]: f for f in findings}
    S.append(P("5. Top 5 errores más importantes", "h2"))
    frame_keys = {}
    if analysis.source_type == "video":
        with session_scope() as db:
            frame_keys = {fr.label: fr.storage_key for fr in db.scalars(select(Frame).where(Frame.analysis_id == analysis.id))}
    top = rep.get("top_errors") or []
    if not top:
        S.append(P("No se verificaron errores relevantes.", "muted"))
    for i, te in enumerate(top, 1):
        f = by_id.get(te.get("finding_id"))
        if not f:
            continue
        block = [P(f"<b>{i}. [{fmt_t(f['t_start'])}] {_esc(f['title'])}</b> &nbsp;<font color='{SEV_COLORS[f['severity']]}'>■ {SEV_LABEL[f['severity']]}</font> · {CATEGORY_LABELS.get(f['category'], f['category'])} · {ERROR_TYPE_LABELS.get(f['error_type'] or '', '')}", "h3")]
        block.append(P(f"<b>Qué pasó:</b> {_esc(f['what_happened'])}"))
        block.append(P(f"<b>Por qué es un error:</b> {_esc(f['why_error'])}"))
        block.append(P(f"<b>Qué debió hacer:</b> {_esc(f['what_to_do'])}"))
        block.append(P(f"<b>Cómo evitarlo:</b> {_esc(f['how_to_avoid'])}"))
        if te.get("comment"):
            block.append(P(f"<i>Coach: {_esc(te['comment'])}</i>"))
        imgs = [e["id"] for e in f.get("evidence", []) if e["id"] in frame_keys][:2]
        if imgs:
            cells = []
            for lab in imgs:
                try:
                    data = get_storage().read_bytes(frame_keys[lab])
                    cells.append([Image(io.BytesIO(data), width=80 * mm, height=45 * mm), P(f"{lab} · {fmt_t(next(e['t'] for e in f['evidence'] if e['id'] == lab))}", "small")])
                except Exception:  # noqa: BLE001
                    continue
            if cells:
                it = Table([[c[0] for c in cells], [c[1] for c in cells]], colWidths=[84 * mm] * len(cells))
                block.append(it)
        S.append(KeepTogether(block))

    section("6. Early game", rep.get("early_game"))
    section("7. Mid game", rep.get("mid_game"))
    section("8. Endgame", rep.get("endgame"))
    section("9. Peleas", rep.get("fights"))
    if rep.get("recommendations"):
        S.append(P("10. Recomendaciones personalizadas", "h2"))
        for r in rep["recommendations"]:
            S.append(P(f"<b>{_esc(r['title'])}</b> ({CATEGORY_LABELS.get(r['category'], '')}) — {_esc(r['detail'])}"))
    if rep.get("drills"):
        S.append(P("11. Ejercicios para mejorar", "h2"))
        for d in rep["drills"]:
            S.append(P(f"<b>{_esc(d['name'])}</b> · {d['duration_minutes']} min — <i>{_esc(d['goal'])}</i><br/>{_esc(d['how'])}"))
    if rep.get("next_session_goals"):
        S.append(P("12. Objetivos para la próxima sesión", "h2"))
        for g in rep["next_session_goals"]:
            S.append(P(f"☐ <b>{_esc(g['title'])}</b> — {_esc(g['measurable_target'])}"))

    S.append(PageBreak())
    S.append(P("Anexo A · Todos los errores", "h2"))
    live = [f for f in findings if f["review_status"] != "dismissed"]
    rows = [[P("<b>Tiempo</b>", "small"), P("<b>Error</b>", "small"), P("<b>Categoría</b>", "small"), P("<b>Gravedad</b>", "small"), P("<b>Origen</b>", "small")]]
    for f in live:
        rows.append([P(fmt_t(f["t_start"]), "small"), P(_esc(f["title"]), "small"), P(CATEGORY_LABELS.get(f["category"], f["category"]), "small"),
                     P(f"<font color='{SEV_COLORS[f['severity']]}'>{SEV_LABEL[f['severity']]}</font>", "small"), P("Coach" if f["origin"] == "coach" else "IA", "small")])
    t = Table(rows, colWidths=[18 * mm, 82 * mm, 34 * mm, 18 * mm, 16 * mm], repeatRows=1)
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f4f9")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    S.append(t)
    if notes:
        S.append(P("Anexo B · Notas del coach", "h2"))
        for n in notes:
            S.append(P(f"<b>{fmt_t(n['t']) if n['t'] is not None else 'General'}</b> — {_esc(n['text'])}"))
    S.append(P("Anexo C · Metodología y limitaciones", "h2"))
    m = scores.get("methodology") or {}
    S.append(P(f"Fórmula por categoría: {_esc(m.get('formula'))}"))
    for n in m.get("notes", []):
        S.append(P("• " + _esc(n), "small"))
    cov = analysis.coverage or {}
    if analysis.source_type == "video":
        S.append(P(f"Cobertura: {cov.get('frames')} fotogramas analizados en {cov.get('segments_analysed')}/{cov.get('segments_total')} segmentos; {cov.get('analysed_minutes')} min de gameplay. Fases: {cov.get('phase_method')}. Afirmaciones sin evidencia descartadas: {cov.get('dropped_unverified_claims')}.", "small"))
    else:
        S.append(P(f"Replay interpretada con {cov.get('adapter')} ({_esc(cov.get('adapter_version'))}). Datos no disponibles: {', '.join(cov.get('unavailable') or []) or 'ninguno'}.", "small"))
    for lim in rep.get("limitations", []):
        S.append(P("• " + _esc(lim), "small"))

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 9 * mm, "Fortnite VOD Analyzer · Puntuaciones orientativas, no oficiales de Epic Games")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Página {d.page}")
        canvas.restoreState()

    doc.build(S, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
