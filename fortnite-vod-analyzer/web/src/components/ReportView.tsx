"use client";

import { Download, Info, Target } from "lucide-react";
import { useState } from "react";
import { downloadFile, post } from "@/lib/api";
import { CATEGORY_LABEL, ERROR_TYPE_LABEL, fmtTime, scoreTone } from "@/lib/format";
import type { AnalysisBundle, Category, Match } from "@/lib/types";
import { Badge, Button, Card, CardHeader, ScoreBar, ScoreRing, SeverityBadge, cx } from "./ui";

export function ReportView({ match, bundle, onOpenFinding }: { match: Match; bundle: AnalysisBundle; onOpenFinding: (id: string) => void }) {
  const a = bundle.analysis!;
  const r = a.report;
  const s = a.scores;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [goalsMsg, setGoalsMsg] = useState<string | null>(null);
  const [showMethod, setShowMethod] = useState(false);
  const byId = Object.fromEntries(bundle.findings.map((f) => [f.id, f]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button icon={<Target className="size-4" />} onClick={async () => { const x = await post(`/matches/${match.id}/goals-from-report`); setGoalsMsg(x.created ? `${x.created} objetivos añadidos al perfil del jugador` : "Los objetivos ya estaban añadidos"); }}>Añadir objetivos al jugador</Button>
        <Button variant="primary" icon={<Download className="size-4" />} loading={pdfBusy} onClick={async () => { setPdfBusy(true); try { await downloadFile(`/matches/${match.id}/report.pdf`, "informe.pdf"); } finally { setPdfBusy(false); } }}>Exportar PDF</Button>
      </div>
      {r.generated_by === "rules" && <div className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-ink-2">Informe generado por reglas a partir de datos medidos (HUD, audio, eventos). Posicionamiento, mecánicas y decisiones complejas requieren tu revisión en el VOD o activar la IA de visión.</div>}
      {goalsMsg && <div className="rounded-lg border border-[#1d3766] bg-brand-soft px-4 py-2 text-sm">{goalsMsg}</div>}

      <Card>
        <div className="grid gap-6 p-5 md:grid-cols-[auto_1fr] md:items-center">
          <div className="flex flex-col items-center gap-2"><ScoreRing score={s.overall} size={132} label="Global" /><span className="text-xs text-ink-3">{s.analysed_minutes} min analizados</span></div>
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {Object.entries(s.categories).map(([k, c]) => (
              <div key={k}>
                <div className="mb-1 flex justify-between text-sm"><span className="text-ink-2">{c.label}</span><span className={cx("tabular font-semibold", scoreTone(c.score))}>{c.score ?? <span className="text-xs font-normal text-ink-3">sin datos</span>}</span></div>
                <ScoreBar score={c.score} />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-line px-5 py-3">
          <button onClick={() => setShowMethod(!showMethod)} className="flex items-center gap-2 text-xs text-ink-3 hover:text-ink"><Info className="size-3.5" />{s.methodology.disclaimer} <span className="text-brand">{showMethod ? "Ocultar" : "Ver metodología"}</span></button>
          {showMethod && (
            <div className="mt-3 space-y-2 text-xs text-ink-2">
              <p className="font-mono">{s.methodology.formula}</p>
              <p>Pesos por gravedad: {Object.entries(s.methodology.severity_weights).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
              <ul className="list-disc pl-4">{s.methodology.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <table className="mt-2 text-left">
                <thead className="text-ink-3"><tr><th className="pr-4 font-medium">Categoría</th><th className="pr-4 font-medium">Errores</th><th className="pr-4 font-medium">Penalización</th><th className="font-medium">Bonus</th></tr></thead>
                <tbody>{Object.values(s.categories).map((c) => <tr key={c.label}><td className="pr-4">{c.label}</td><td className="tabular pr-4">{c.findings}</td><td className="tabular pr-4">{c.penalty ?? "—"}</td><td className="tabular">{c.bonus ?? "—"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section n={1} title="Resumen de la partida" text={r.match_summary} />
        <Section n={2} title="Evaluación general" text={r.overall_evaluation} />
        <ListSection n={3} title="Puntos fuertes" items={r.strengths} tone="ok" />
        <ListSection n={4} title="Puntos débiles" items={r.weaknesses} tone="danger" />
      </div>

      <Card>
        <CardHeader title="5 · Top 5 errores más importantes" subtitle="Ordenados por gravedad × confianza. Pulsa para verlo en el VOD." />
        <ol className="divide-y divide-line">
          {(r.top_errors || []).map((te, i) => {
            const f = te.finding_id ? byId[te.finding_id] : null;
            if (!f) return null;
            return (
              <li key={te.ref}>
                <button onClick={() => onOpenFinding(f.id)} className="flex w-full gap-4 px-5 py-4 text-left hover:bg-surface-2">
                  <span className="tabular grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><span className="tabular font-mono text-xs text-brand">{fmtTime(f.t_start)}</span><span className="font-medium">{f.title}</span><SeverityBadge s={f.severity} />{f.error_type && <Badge>{ERROR_TYPE_LABEL[f.error_type]}</Badge>}</span>
                    <span className="mt-1 block text-sm text-ink-2">{f.what_happened}</span>
                    <span className="mt-1 block text-sm"><span className="text-ink-3">Debió: </span>{f.what_to_do}</span>
                    {te.comment && <span className="mt-1 block text-sm italic text-ink-3">{te.comment}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {!(r.top_errors || []).length && <li className="px-5 py-6 text-sm text-ink-3">No se verificaron errores relevantes.</li>}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section n={6} title="Early game" text={r.early_game} />
        <Section n={7} title="Mid game" text={r.mid_game} />
        <Section n={8} title="Endgame" text={r.endgame} />
        <Section n={9} title="Peleas" text={r.fights} />
      </div>

      <Card>
        <CardHeader title="10 · Recomendaciones personalizadas" />
        <ul className="grid gap-px bg-line sm:grid-cols-2">
          {r.recommendations.map((x, i) => (
            <li key={i} className="bg-surface p-5"><div className="flex items-center gap-2"><span className="font-medium">{x.title}</span><Badge>{CATEGORY_LABEL[x.category as Category]}</Badge></div><p className="mt-1 text-sm text-ink-2">{x.detail}</p></li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="11 · Ejercicios para mejorar" />
          <ul className="divide-y divide-line">
            {r.drills.map((d, i) => (
              <li key={i} className="px-5 py-4">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{d.name}</span><span className="tabular text-xs text-ink-3">{d.duration_minutes} min</span></div>
                <p className="mt-1 text-sm text-ink-3">{d.goal}</p>
                <p className="mt-1 text-sm text-ink-2">{d.how}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="12 · Objetivos para la próxima sesión" />
          <ul className="divide-y divide-line">
            {r.next_session_goals.map((g, i) => (
              <li key={i} className="flex gap-3 px-5 py-4"><span className="mt-1 size-4 shrink-0 rounded border border-line-strong" /><span><span className="block font-medium">{g.title}</span><span className="text-sm text-ink-2">{g.measurable_target}</span></span></li>
            ))}
          </ul>
        </Card>
      </div>

      {(r.limitations?.length || r.not_assessable) && (
        <Card>
          <CardHeader title="Limitaciones del análisis" subtitle="Lo que no se pudo verificar no se ha evaluado" />
          <div className="space-y-2 p-5 text-sm text-ink-2">
            {r.limitations?.map((l) => <p key={l}>· {l}</p>)}
            {r.not_assessable && Object.entries(r.not_assessable).filter(([, v]) => v.length).map(([k, v]) => <p key={k}><span className="text-ink-3">{k}:</span> {v.join("; ")}</p>)}
          </div>
        </Card>
      )}
    </div>
  );
}

function Section({ n, title, text }: { n: number; title: string; text: string }) {
  return <Card><CardHeader title={`${n} · ${title}`} /><p className="whitespace-pre-wrap p-5 text-sm leading-relaxed text-ink-2">{text || "—"}</p></Card>;
}

function ListSection({ n, title, items, tone }: { n: number; title: string; items: string[]; tone: "ok" | "danger" }) {
  return (
    <Card>
      <CardHeader title={`${n} · ${title}`} />
      <ul className="space-y-2 p-5 text-sm text-ink-2">
        {items.map((x) => <li key={x} className="flex gap-2"><span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-ok" : "bg-sev-high")} />{x}</li>)}
        {!items.length && <li className="text-ink-3">—</li>}
      </ul>
    </Card>
  );
}
