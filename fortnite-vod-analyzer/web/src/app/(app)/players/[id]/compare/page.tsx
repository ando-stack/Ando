"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardHeader, ErrorBox, Loading, PageHeader, SeverityBadge, cx } from "@/components/ui";
import { CATEGORY_LABEL, SEVERITY_ORDER, fmtDate, fmtTime, scoreTone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Category } from "@/lib/types";

function Compare() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const { data, error, loading, reload } = useApi<any>(`/players/${id}/compare?a=${sp.get("a")}&b=${sp.get("b")}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const { a, b, deltas } = data;
  const keys = Array.from(new Set([...Object.keys(a.scores.categories || {}), ...Object.keys(b.scores.categories || {})]));
  const cats = Array.from(new Set([...Object.keys(a.findings_by_category), ...Object.keys(b.findings_by_category)]));

  const Head = ({ x, tag }: { x: any; tag: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{tag}</div>
      <Link href={`/matches/${x.match.id}`} className="block truncate font-medium hover:text-brand">{x.match.title}</Link>
      <div className="text-xs text-ink-3">{fmtDate(x.match.played_at || x.match.created_at)} · {x.match.source_type === "video" ? "Vídeo" : "Replay"}</div>
    </div>
  );

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Comparativa" title={a.match.player_name || "Jugador"} subtitle="Misma metodología de puntuación en ambas partidas; las diferencias de cobertura (minutos, fuente) afectan a la comparación." />
      <Card>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-line px-5 py-4">
          <Head x={a} tag="Partida A" />
          <div className="text-center">
            <div className="text-xs text-ink-3">Δ global</div>
            <div className={cx("tabular text-2xl font-semibold", data.overall_delta > 0 ? "text-ok" : data.overall_delta < 0 ? "text-sev-critical" : "text-ink")}>
              {data.overall_delta == null ? "—" : `${data.overall_delta > 0 ? "+" : ""}${data.overall_delta}`}
            </div>
          </div>
          <div className="text-right"><Head x={b} tag="Partida B" /></div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Global" va={a.scores.overall} vb={b.scores.overall} d={data.overall_delta} strong />
            {keys.map((k) => <Row key={k} label={(a.scores.categories[k] || b.scores.categories[k]).label} va={a.scores.categories[k]?.score} vb={b.scores.categories[k]?.score} d={deltas[k]} />)}
          </tbody>
        </table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Errores por categoría" />
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-ink-3"><th className="px-5 py-2 text-left font-medium">Categoría</th><th className="px-3 py-2 text-right font-medium">A</th><th className="px-5 py-2 text-right font-medium">B</th></tr></thead>
            <tbody>
              {cats.map((c) => {
                const x = a.findings_by_category[c] || 0, y = b.findings_by_category[c] || 0;
                return <tr key={c} className="border-t border-line"><td className="px-5 py-2 text-ink-2">{CATEGORY_LABEL[c as Category] || c}</td><td className="tabular px-3 py-2 text-right">{x}</td><td className={cx("tabular px-5 py-2 text-right", y < x ? "text-ok" : y > x ? "text-sev-critical" : "")}>{y}</td></tr>;
              })}
              <tr className="border-t border-line font-medium"><td className="px-5 py-2">Total</td><td className="tabular px-3 py-2 text-right">{a.findings_total}</td><td className="tabular px-5 py-2 text-right">{b.findings_total}</td></tr>
            </tbody>
          </table>
          <div className="flex gap-4 border-t border-line px-5 py-3 text-xs text-ink-3">
            {SEVERITY_ORDER.map((s) => <span key={s} className="flex items-center gap-1.5"><SeverityBadge s={s} /> {a.findings_by_severity[s] || 0} → {b.findings_by_severity[s] || 0}</span>)}
          </div>
        </Card>
        <Card>
          <CardHeader title="Errores principales" />
          <div className="grid gap-px bg-line sm:grid-cols-2">
            {[a, b].map((x, i) => (
              <div key={i} className="bg-surface p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Partida {i ? "B" : "A"}</div>
                <ul className="space-y-2">
                  {x.top_findings.map((f: any) => (
                    <li key={f.id} className="text-sm"><span className="tabular mr-1.5 font-mono text-xs text-brand">{fmtTime(f.t_start)}</span>{f.title} <SeverityBadge s={f.severity} /></li>
                  ))}
                  {!x.top_findings.length && <li className="text-sm text-ink-3">Sin errores</li>}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, va, vb, d, strong }: { label: string; va: number | null; vb: number | null; d: number | null; strong?: boolean }) {
  return (
    <tr className={cx("border-b border-line last:border-0", strong && "bg-surface-2 font-medium")}>
      <td className="px-5 py-2.5 text-ink-2">{label}</td>
      <td className={cx("tabular px-3 py-2.5 text-right", scoreTone(va))}>{va ?? "sin datos"}</td>
      <td className={cx("tabular px-3 py-2.5 text-right", scoreTone(vb))}>{vb ?? "sin datos"}</td>
      <td className={cx("tabular w-20 px-5 py-2.5 text-right text-xs", d == null ? "text-ink-3" : d > 0 ? "text-ok" : d < 0 ? "text-sev-critical" : "text-ink-3")}>{d == null ? "—" : `${d > 0 ? "+" : ""}${d}`}</td>
    </tr>
  );
}

export default function ComparePage() {
  return <Suspense fallback={<Loading />}><Compare /></Suspense>;
}
