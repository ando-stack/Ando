"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, PageHeader, Spinner } from "@/components/ui";
import { get } from "@/lib/api";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/format";
import { ActivityChart } from "@/components/ActivityChart";

interface TS {
  by_category: { category: string; count: number }[]; by_status: { status: string; count: number }[];
  score_histogram: { bucket: number; count: number }[]; by_channel: { channel: string; count: number }[];
}

function Bars({ data, x, label }: { data: Record<string, unknown>[]; x: string; label: string }) {
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#2a2e38" vertical={false} />
          <XAxis dataKey={x} tick={{ fill: "#9097a7", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={{ fill: "#636a7a", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(139,92,246,.08)" }} contentStyle={{ background: "#1b1e25", border: "1px solid #2a2e38", borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="count" name={label} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function StatsPage() {
  const ts = useQuery({ queryKey: ["stats", "dist"], queryFn: () => get<TS>("/stats/timeseries?days=30") });
  if (!ts.data) return <Spinner />;
  const t = ts.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Estadísticas" description="Distribución real de tus clips. La puntuación estima interés relativo; no es una probabilidad de viralidad." />
      <Card><CardHeader title="Actividad diaria" /><div className="p-3"><ActivityChart /></div></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Clips por categoría" /><div className="p-3"><Bars data={t.by_category.map((c) => ({ ...c, label: CATEGORY_LABELS[c.category] ?? c.category }))} x="label" label="Clips" /></div></Card>
        <Card><CardHeader title="Distribución de puntuaciones" /><div className="p-3"><Bars data={t.score_histogram.map((h) => ({ ...h, label: `${h.bucket}-${h.bucket + 9}` }))} x="label" label="Clips" /></div></Card>
        <Card><CardHeader title="Clips por estado" /><div className="p-3"><Bars data={t.by_status.map((s) => ({ ...s, label: STATUS_LABELS[s.status] ?? s.status }))} x="label" label="Clips" /></div></Card>
        <Card><CardHeader title="Clips por canal" /><div className="p-3">{t.by_channel.length ? <Bars data={t.by_channel} x="channel" label="Clips" /> : <p className="p-6 text-sm text-muted">Sin clips de canales todavía.</p>}</div></Card>
      </div>
    </div>
  );
}
