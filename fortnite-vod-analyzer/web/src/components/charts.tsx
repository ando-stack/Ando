"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#6e7789" };

export function ScoreLineChart({ data, height = 240 }: { data: { date: string; overall: number | null; title?: string; player_name?: string }[]; height?: number }) {
  const rows = data.filter((d) => d.overall != null).map((d, i) => ({ ...d, i: i + 1, label: fmtDate(d.date) }));
  if (rows.length === 0) return <div className="grid place-items-center text-sm text-ink-3" style={{ height }}>Sin análisis puntuados todavía</div>;
  return (
    <div style={{ height }} role="img" aria-label="Evolución de la puntuación global">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1b1f2a" vertical={false} />
          <XAxis dataKey="i" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `#${v}`} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ stroke: "#30374a" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as any;
              return (
                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-xl">
                  <div className="font-medium text-ink">{p.title}</div>
                  <div className="text-ink-3">{p.player_name ? `${p.player_name} · ` : ""}{p.label}</div>
                  <div className="tabular mt-1 text-ink">Global <b>{p.overall}</b></div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="overall" stroke="#2e7dff" strokeWidth={2} dot={{ r: 4, fill: "#2e7dff", stroke: "#0e1014", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal magnitude bars (single hue), value labelled in text ink. */
export function HBars({ rows, unit = "" }: { rows: { key: string; label: string; value: number; hint?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="py-10 text-center text-sm text-ink-3">Sin datos todavía</div>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[120px_1fr_40px] items-center gap-3 text-sm" title={r.hint || `${r.label}: ${r.value}${unit}`}>
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-brand transition-[width] duration-500 group-hover:bg-[#5b9bff]" style={{ width: `${(100 * r.value) / max}%` }} />
          </span>
          <span className="tabular text-right text-ink">{r.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}
