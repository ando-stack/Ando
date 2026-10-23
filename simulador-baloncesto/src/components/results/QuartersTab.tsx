import { useMemo, useState } from 'react';
import type { TabProps } from './types';
import { Section, freqColumns, ouColumns } from './common';
import DataTable from '../DataTable';
import BarChartCard from '../BarChartCard';
import { freqRows, overUnder, quarterSummary, type FreqRow, type QuarterSummary } from '../../../engine/markets';
import { fmtNum, fmtOdds, fmtPct } from '../../lib/format';

export default function QuartersTab({ run, showOdds, lines }: TabProps) {
  const a = run.aggregate;
  const summary = useMemo(() => quarterSummary(a), [a]);
  const [sel, setSel] = useState(0); // 0-3 cuartos, 4-5 mitades
  const Q = sel < 4 ? a.quarters[sel] : a.halves[sel - 4];
  const label = summary[sel].label;
  const totalRows = useMemo(() => freqRows(Q.total.map((c, i) => [String(i), c] as [string, number]), a.n), [Q, a.n]);
  const winnerRows: FreqRow[] = [
    { label: `Gana ${run.home.short}`, count: Math.round(summary[sel].homeWin * a.n), pct: summary[sel].homeWin },
    { label: `Gana ${run.away.short}`, count: Math.round(summary[sel].awayWin * a.n), pct: summary[sel].awayWin },
    { label: 'Empate', count: Math.round(summary[sel].tie * a.n), pct: summary[sel].tie },
  ].sort((x, y) => y.count - x.count);
  const best = [0, 1].map((t) =>
    a.bestQuarter[t]
      .map((c, q) => ({ label: `${q + 1}.º cuarto`, count: c, pct: c / a.n }))
      .sort((x, y) => y.count - x.count),
  );
  const pctCol = (k: 'homeWin' | 'awayWin' | 'tie', name: string) => ({
    key: k,
    label: name,
    num: true,
    render: (r: QuarterSummary) => (
      <span>
        {fmtPct(r[k])}
        {showOdds ? <span className="text-slate-500"> · {fmtOdds(r[k])}</span> : null}
      </span>
    ),
    value: (r: QuarterSummary) => Math.round(r[k] * 1e5) / 1e3,
  });
  return (
    <div className="space-y-6">
      <Section title="Ganador y puntos medios por cuarto y mitad" desc="La 2.ª parte se refiere al tiempo reglamentario (sin prórroga).">
        <DataTable
          rows={summary}
          csvName={`cuartos-${run.label}`}
          columns={[
            { key: 'label', label: 'Periodo', render: (r) => r.label, value: (r) => r.label },
            pctCol('homeWin', `Gana ${run.home.short}`),
            pctCol('tie', 'Empate'),
            pctCol('awayWin', `Gana ${run.away.short}`),
            { key: 'hm', label: `Pts ${run.home.short}`, num: true, render: (r) => fmtNum(r.homeMean), value: (r) => +r.homeMean.toFixed(3) },
            { key: 'am', label: `Pts ${run.away.short}`, num: true, render: (r) => fmtNum(r.awayMean), value: (r) => +r.awayMean.toFixed(3) },
            { key: 'tm', label: 'Total', num: true, render: (r) => fmtNum(r.totalMean), value: (r) => +r.totalMean.toFixed(3) },
          ]}
        />
      </Section>
      <Section title="Mejor cuarto esperado de cada equipo" desc="Probabilidad de que cada cuarto sea el de más puntos del equipo (los empates se reparten).">
        <div className="grid md:grid-cols-2 gap-4">
          {[0, 1].map((t) => (
            <DataTable
              key={t}
              title={t === 0 ? run.home.name : run.away.name}
              rows={best[t]}
              csvName={`mejor-cuarto-${t === 0 ? run.home.short : run.away.short}`}
              columns={[{ key: 'label', label: 'Cuarto', render: (r: FreqRow) => r.label, value: (r: FreqRow) => r.label }, ...freqColumns<FreqRow>((r) => r, showOdds)]}
            />
          ))}
        </div>
      </Section>
      <Section title="Detalle por periodo">
        <div className="flex flex-wrap gap-1">
          {summary.map((s, i) => (
            <button key={s.label} type="button" className={`tab ${sel === i ? 'tab-active' : 'text-slate-400'}`} onClick={() => setSel(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <DataTable title={`Ganador · ${label}`} rows={winnerRows} csvName={`ganador-${label}-${run.label}`} columns={[{ key: 'label', label: 'Resultado', render: (r: FreqRow) => r.label, value: (r: FreqRow) => r.label }, ...freqColumns<FreqRow>((r) => r, showOdds)]} />
          <BarChartCard title={`Total de puntos · ${label}`} data={Q.total.map((c, i) => ({ x: i, pct: c / a.n, count: c })).filter((d) => d.count > 0)} />
          <DataTable title={`Distribución del total · ${label}`} rows={totalRows} csvName={`total-${label}-${run.label}`} columns={[{ key: 'label', label: 'Puntos', render: (r: FreqRow) => r.label, value: (r: FreqRow) => Number(r.label) }, ...freqColumns<FreqRow>((r) => r, showOdds)]} />
          <DataTable title={`Más/menos total · ${label}`} rows={overUnder(Q.total, lines)} csvName={`ou-total-${label}-${run.label}`} columns={ouColumns(showOdds)} pageSize={40} />
          <DataTable title={`Más/menos ${run.home.short} · ${label}`} rows={overUnder(Q.home, lines)} csvName={`ou-${run.home.short}-${label}`} columns={ouColumns(showOdds)} pageSize={40} />
          <DataTable title={`Más/menos ${run.away.short} · ${label}`} rows={overUnder(Q.away, lines)} csvName={`ou-${run.away.short}-${label}`} columns={ouColumns(showOdds)} pageSize={40} />
        </div>
      </Section>
    </div>
  );
}
