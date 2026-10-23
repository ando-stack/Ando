import { useMemo } from 'react';
import type { TabProps } from './types';
import { Section, ouColumns } from './common';
import DataTable from '../DataTable';
import BarChartCard from '../BarChartCard';
import { handicaps, histMean, overUnder, type HandicapRow } from '../../../engine/markets';
import { fmtInt, fmtOdds, fmtPct, fmtSigned } from '../../lib/format';
import type { Column } from '../DataTable';

function hcColumns(showOdds: boolean): Column<HandicapRow>[] {
  const c: Column<HandicapRow>[] = [
    { key: 'line', label: 'Hándicap', num: true, render: (r) => fmtSigned(r.line), value: (r) => r.line },
    { key: 'win', label: 'Cubre (veces)', num: true, render: (r) => fmtInt(r.win), value: (r) => r.win },
    { key: 'pWin', label: 'Cubre %', num: true, render: (r) => fmtPct(r.pWin), value: (r) => Math.round(r.pWin * 1e5) / 1e3 },
    { key: 'lose', label: 'No cubre (veces)', num: true, render: (r) => fmtInt(r.lose), value: (r) => r.lose },
    { key: 'push', label: 'Nulo', num: true, render: (r) => (r.push ? fmtInt(r.push) : '—'), value: (r) => r.push },
  ];
  if (showOdds) c.push({ key: 'odds', label: 'Cuota justa', num: true, render: (r) => fmtOdds(r.pWin), value: (r) => (r.pWin > 0 ? Math.round(100 / r.pWin) / 100 : '') });
  return c;
}

export default function PointsTab({ run, showOdds, lines }: TabProps) {
  const a = run.aggregate;
  const tot = useMemo(() => overUnder(a.totalPts, lines), [a, lines]);
  const home = useMemo(() => overUnder(a.home.hist.pts, lines), [a, lines]);
  const away = useMemo(() => overUnder(a.away.hist.pts, lines), [a, lines]);
  const hh = useMemo(() => handicaps(a, 0, lines), [a, lines]);
  const ha = useMemo(() => handicaps(a, 1, lines), [a, lines]);
  const dist = (h: number[]) => h.map((c, i) => ({ x: i, pct: c / a.n, count: c })).filter((d) => d.count > 0);
  return (
    <div className="space-y-6">
      <Section title="Total de puntos del partido" desc="«Más» = el total supera la línea. Incluye prórrogas.">
        <BarChartCard title="Total de puntos" data={dist(a.totalPts)} refX={Math.round(histMean(a.totalPts))} />
        <DataTable rows={tot} csvName={`ou-total-${run.label}`} columns={ouColumns(showOdds)} pageSize={60} />
      </Section>
      <Section title="Puntos de cada equipo">
        <div className="grid lg:grid-cols-2 gap-4">
          <BarChartCard title={`Puntos ${run.home.name}`} data={dist(a.home.hist.pts)} color="#38bdf8" />
          <BarChartCard title={`Puntos ${run.away.name}`} data={dist(a.away.hist.pts)} color="#f472b6" />
          <DataTable title={`Más/menos ${run.home.short}`} rows={home} csvName={`ou-${run.home.short}-${run.label}`} columns={ouColumns(showOdds)} pageSize={60} />
          <DataTable title={`Más/menos ${run.away.short}`} rows={away} csvName={`ou-${run.away.short}-${run.label}`} columns={ouColumns(showOdds)} pageSize={60} />
        </div>
      </Section>
      <Section title="Hándicaps" desc="El equipo cubre el hándicap si su margen final más la línea es mayor que cero (por ejemplo, −5,5 = gana por 6 o más).">
        <div className="grid lg:grid-cols-2 gap-4">
          <DataTable title={`Hándicap ${run.home.short}`} rows={hh} csvName={`handicap-${run.home.short}-${run.label}`} columns={hcColumns(showOdds)} pageSize={80} />
          <DataTable title={`Hándicap ${run.away.short}`} rows={ha} csvName={`handicap-${run.away.short}-${run.label}`} columns={hcColumns(showOdds)} pageSize={80} />
        </div>
      </Section>
    </div>
  );
}
