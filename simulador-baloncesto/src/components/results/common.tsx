import type { ReactNode } from 'react';
import { fmtOdds, fmtPct, fmtInt } from '../../lib/format';
import type { Column } from '../DataTable';
import type { OverUnderRow } from '../../../engine/markets';

/** Columnas de "veces · % · cuota justa" para filas de frecuencia. */
export function freqColumns<T>(get: (r: T) => { count: number; pct: number }, showOdds: boolean): Column<T>[] {
  const cols: Column<T>[] = [
    { key: 'count', label: 'Veces', num: true, render: (r) => fmtInt(get(r).count), value: (r) => get(r).count },
    { key: 'pct', label: '%', num: true, render: (r) => fmtPct(get(r).pct, 2), value: (r) => Math.round(get(r).pct * 1e6) / 1e4 },
  ];
  if (showOdds)
    cols.push({ key: 'odds', label: 'Cuota justa', num: true, render: (r) => fmtOdds(get(r).pct), value: (r) => (get(r).pct > 0 ? Math.round((1 / get(r).pct) * 100) / 100 : '') });
  return cols;
}

/** Columnas para over/under. */
export function ouColumns(showOdds: boolean): Column<OverUnderRow>[] {
  const cols: Column<OverUnderRow>[] = [
    { key: 'line', label: 'Línea', num: true, render: (r) => r.line.toLocaleString('es-ES', { minimumFractionDigits: 1 }), value: (r) => r.line },
    { key: 'over', label: 'Más (veces)', num: true, render: (r) => fmtInt(r.over), value: (r) => r.over },
    { key: 'pOver', label: 'Más %', num: true, render: (r) => fmtPct(r.pOver), value: (r) => Math.round(r.pOver * 1e5) / 1e3 },
    { key: 'under', label: 'Menos (veces)', num: true, render: (r) => fmtInt(r.under), value: (r) => r.under },
    { key: 'pUnder', label: 'Menos %', num: true, render: (r) => fmtPct(r.pUnder), value: (r) => Math.round(r.pUnder * 1e5) / 1e3 },
    { key: 'push', label: 'Nulo', num: true, render: (r) => (r.push ? fmtInt(r.push) : '—'), value: (r) => r.push },
  ];
  if (showOdds) {
    cols.push({ key: 'oOver', label: 'Cuota más', num: true, render: (r) => fmtOdds(r.pOver), value: (r) => (r.pOver > 0 ? Math.round(100 / r.pOver) / 100 : '') });
    cols.push({ key: 'oUnder', label: 'Cuota menos', num: true, render: (r) => fmtOdds(r.pUnder), value: (r) => (r.pUnder > 0 ? Math.round(100 / r.pUnder) / 100 : '') });
  }
  return cols;
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Section({ title, children, desc }: { title: string; children: ReactNode; desc?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {desc && <p className="text-xs text-slate-400">{desc}</p>}
      </div>
      {children}
    </section>
  );
}
