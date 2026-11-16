"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Clock, Cpu, HardDrive, ListChecks, Radio, Tv, Upload, Zap } from "lucide-react";
import Link from "next/link";
import { ActivityChart, type Dashboard } from "@/components/ActivityChart";
import { ClipCard } from "@/components/ClipCard";
import { Badge, Card, CardHeader, PageHeader, Progress, Spinner, Stat } from "@/components/ui";
import { get } from "@/lib/api";
import { fmtBytes, fmtNumber, timeAgo } from "@/lib/format";
import type { Clip } from "@/lib/types";

export default function DashboardPage() {
  const d = useQuery({ queryKey: ["stats", "dashboard"], queryFn: () => get<Dashboard>("/stats/dashboard"), refetchInterval: 15000 });
  const top = useQuery({ queryKey: ["clips", "top"], queryFn: () => get<{ items: Clip[] }>("/clips?sort=score&limit=4") });
  if (!d.data) return <Spinner />;
  const s = d.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Datos reales de tu estudio, calculados a partir de la base de datos."
        actions={<><Link className="btn-secondary" href="/import"><Upload className="h-4 w-4" />Importar</Link><Link className="btn-primary" href="/"><Radio className="h-4 w-4" />Monitor de directos</Link></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Canales seguidos" value={s.channels_monitored} hint={`${s.channels_total} en total`} icon={<Tv className="h-4 w-4" />} />
        <Stat label="En directo ahora" value={s.channels_live} icon={<Radio className="h-4 w-4" />} />
        <Stat label="Directos analizados" value={s.streams_analyzed} hint={`${s.streams_total} emisiones registradas`} />
        <Stat label="Horas procesadas" value={s.hours_processed} icon={<Clock className="h-4 w-4" />} />
        <Stat label="Candidatos" value={fmtNumber(s.candidates)} icon={<ListChecks className="h-4 w-4" />} />
        <Stat label="Clips creados" value={fmtNumber(s.clips_created)} hint={`${s.clips_approved} aprobados · ${s.clips_exported} exportados`} icon={<Clapperboard className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card><CardHeader title="Actividad (30 días)" subtitle="Candidatos detectados y clips creados por día" /><div className="p-3"><ActivityChart /></div></Card>
        <Card>
          <CardHeader title="Rendimiento y recursos" />
          <div className="space-y-3 p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Análisis medio</span><span>{s.avg_analysis_seconds ? `${s.avg_analysis_seconds} s` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Render medio</span><span>{s.avg_render_seconds ? `${s.avg_render_seconds} s` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Latencia media en directo</span><span>{s.avg_live_latency_seconds ? `${s.avg_live_latency_seconds} s` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted">Trabajos activos</span><span>{s.jobs_active}</span></div>
            <div>
              <div className="mb-1 flex justify-between text-xs"><span className="flex items-center gap-1 text-muted"><HardDrive className="h-3.5 w-3.5" />Almacenamiento</span><span>{fmtBytes(s.storage_used_bytes)} / {fmtBytes(s.storage_quota_bytes)}</span></div>
              <Progress value={s.storage_used_bytes / Math.max(1, s.storage_quota_bytes)} />
            </div>
            <div className="border-t border-line pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted"><Cpu className="h-3.5 w-3.5" />Workers</div>
              {s.workers.length === 0 && <p className="text-xs text-warn">Ningún worker ha enviado latido todavía.</p>}
              {s.workers.map((w) => (
                <div key={w.id} className="flex items-center justify-between py-1 text-xs">
                  <span className="truncate">{w.kind} · {w.hostname}</span>
                  <Badge tone={w.alive ? "ok" : "danger"} dot>{w.alive ? "Activo" : timeAgo(w.last_seen_at)}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h3 className="mb-3 text-sm font-semibold">Mejores clips</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{top.data?.items.map((c) => <ClipCard key={c.id} clip={c} />)}</div>
          {top.data?.items.length === 0 && <p className="text-sm text-muted">Todavía no hay clips.</p>}
        </div>
        <Card>
          <CardHeader title="Errores recientes" icon={<AlertTriangle className="h-4 w-4" />} />
          <ul className="divide-y divide-line">
            {s.recent_errors.map((e) => (
              <li key={e.id} className="px-4 py-2.5 text-xs"><div className="flex justify-between text-faint"><span>{e.job_type}</span><span>{timeAgo(e.created_at)}</span></div><p className="mt-0.5 line-clamp-2 text-danger/90">{e.message}</p></li>
            ))}
            {s.recent_errors.length === 0 && <li className="flex items-center gap-2 px-4 py-4 text-xs text-muted"><Zap className="h-3.5 w-3.5 text-ok" />Sin errores recientes.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
