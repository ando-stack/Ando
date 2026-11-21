"use client";

import { AlertTriangle, Film, Gauge, Target, Users } from "lucide-react";
import Link from "next/link";
import { HBars, ScoreLineChart } from "@/components/charts";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Loading, PageHeader, Progress, Stat, cx } from "@/components/ui";
import { CATEGORY_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER, fmtRelative, scoreTone } from "@/lib/format";
import { useApi, useInterval } from "@/lib/hooks";
import type { Category } from "@/lib/types";

export default function DashboardPage() {
  const { data, error, loading, reload } = useApi<any>("/dashboard");
  useInterval(reload, data?.running_jobs?.length ? 4000 : null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const t = data.totals;
  const sevTotal = SEVERITY_ORDER.reduce((a, s) => a + (t.findings_by_severity[s] || 0), 0);

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Panel del coach" title="Dashboard" subtitle="Resumen de tus jugadores, análisis y objetivos" actions={<Link href="/matches/new"><Button variant="primary">Nueva partida</Button></Link>} />

      {t.players === 0 ? (
        <Card>
          <Empty icon={<Users className="size-5" />} title="Empieza creando un jugador" text="Crea el perfil del jugador al que entrenas y sube su primera partida (vídeo o replay)."
            action={<Link href="/players"><Button variant="primary">Crear jugador</Button></Link>} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Partidas analizadas" value={t.analyses} hint={`${t.matches} partidas en total`} icon={<Film className="size-4" />} />
            <Stat label="Jugadores" value={t.players} icon={<Users className="size-4" />} />
            <Stat label="Media global" value={<span className={scoreTone(t.avg_score)}>{t.avg_score ?? "—"}</span>} hint="Orientativa, 0–100" icon={<Gauge className="size-4" />} />
            <Stat label="Objetivos pendientes" value={t.pending_goals} icon={<Target className="size-4" />} />
          </div>

          {data.running_jobs.length > 0 && (
            <Card className="mt-4">
              <CardHeader title="Análisis en curso" />
              <ul className="divide-y divide-line">
                {data.running_jobs.map((j: any) => (
                  <li key={j.id} className="px-5 py-3">
                    <Link href={`/matches/${j.match_id}`} className="flex items-center justify-between gap-4 text-sm hover:text-brand">
                      <span className="truncate font-medium">{j.title}</span>
                      <span className="tabular text-ink-3">{j.stage || "En cola"} · {Math.round(j.progress)}%</span>
                    </Link>
                    <div className="mt-2"><Progress value={j.progress} /></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Evolución del rendimiento" subtitle="Puntuación global de cada análisis, en orden cronológico" />
              <div className="p-4"><ScoreLineChart data={data.evolution} /></div>
            </Card>
            <Card>
              <CardHeader title="Errores más frecuentes" subtitle="Hallazgos no descartados, por categoría" />
              <div className="p-5"><HBars rows={data.frequent_errors.slice(0, 8).map((f: any) => ({ key: f.category, label: CATEGORY_LABEL[f.category as Category] || f.category, value: f.count }))} /></div>
              {sevTotal > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <div className="mb-2 text-xs text-ink-3">Por gravedad</div>
                  <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
                    {SEVERITY_ORDER.map((s) => t.findings_by_severity[s] ? <div key={s} style={{ flex: t.findings_by_severity[s], background: SEVERITY_COLOR[s] }} title={`${SEVERITY_LABEL[s]}: ${t.findings_by_severity[s]}`} /> : null)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                    {SEVERITY_ORDER.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />{SEVERITY_LABEL[s]} <span className="tabular text-ink">{t.findings_by_severity[s] || 0}</span></span>)}
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-1">
              <CardHeader title="Últimos análisis" />
              {data.recent_analyses.length === 0 ? <Empty title="Aún no hay análisis" /> : (
                <ul className="divide-y divide-line">
                  {data.recent_analyses.map((a: any) => (
                    <li key={a.match_id}>
                      <Link href={`/matches/${a.match_id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.title}</div>
                          <div className="text-xs text-ink-3">{a.player_name} · {a.findings} errores · {fmtRelative(a.created_at)}</div>
                        </div>
                        <div className={cx("tabular text-lg font-semibold", scoreTone(a.overall))}>{a.overall ?? "—"}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Objetivos pendientes" />
              {data.pending_goals.length === 0 ? <Empty title="Sin objetivos pendientes" text="Añádelos desde el perfil del jugador o importándolos de un informe." /> : (
                <ul className="divide-y divide-line">
                  {data.pending_goals.map((g: any) => (
                    <li key={g.id}>
                      <Link href={`/players/${g.player_id}`} className="block px-5 py-3 hover:bg-surface-2">
                        <div className="text-sm">{g.title}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">{g.player_name}{g.category && <Badge>{CATEGORY_LABEL[g.category as Category] || g.category}</Badge>}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Actividad reciente" />
              <ul className="space-y-0 px-5 py-3">
                {data.activity.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Sin actividad</li>}
                {data.activity.map((a: any) => (
                  <li key={a.id} className="flex gap-3 py-2 text-sm">
                    <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", a.kind === "analysis_failed" ? "bg-sev-critical" : a.kind === "analysis_completed" ? "bg-brand" : "bg-ink-3")} />
                    <div className="min-w-0">
                      {a.match_id ? <Link className="hover:text-brand" href={`/matches/${a.match_id}`}>{a.message}</Link> : <span>{a.message}</span>}
                      <div className="text-xs text-ink-3">{fmtRelative(a.created_at)}</div>
                    </div>
                    {a.kind === "analysis_failed" && <AlertTriangle className="ml-auto size-4 shrink-0 text-sev-critical" />}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
