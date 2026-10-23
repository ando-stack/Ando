import { useMemo, useState } from 'react';
import type { TabProps } from './types';
import { Section, freqColumns, ouColumns } from './common';
import DataTable from '../DataTable';
import BarChartCard from '../BarChartCard';
import { freqRows, histMean, overUnder, type FreqRow } from '../../../engine/markets';
import { TEAM_KEYS, type TeamKey } from '../../../engine/aggregate';
import { TEAM_STAT_LABEL } from './labels';
import { fmtNum } from '../../lib/format';

export default function TeamStatsTab({ run, showOdds, lines }: TabProps) {
  const a = run.aggregate;
  const keys = TEAM_KEYS.filter((k) => k !== 'pts');
  const [k, setK] = useState<TeamKey>('reb');
  const sides = [
    { id: 'home' as const, name: run.home.short, color: '#38bdf8' },
    { id: 'away' as const, name: run.away.short, color: '#f472b6' },
    { id: 'match' as const, name: 'Partido (suma)', color: '#f59e0b' },
  ];
  const dist = useMemo(
    () =>
      sides.map((s) => ({
        ...s,
        rows: freqRows(a[s.id].hist[k].map((c, i) => [String(i), c] as [string, number]), a.n),
        ou: overUnder(a[s.id].hist[k], lines),
        chart: a[s.id].hist[k].map((c, i) => ({ x: i, pct: c / a.n, count: c })).filter((d) => d.count > 0),
        mean: histMean(a[s.id].hist[k]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, k, lines],
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1">
        {keys.map((x) => (
          <button key={x} type="button" className={`tab ${k === x ? 'tab-active' : 'text-slate-400'}`} onClick={() => setK(x)}>
            {TEAM_STAT_LABEL[x]}
          </button>
        ))}
      </div>
      <Section title={TEAM_STAT_LABEL[k]} desc={`Media: ${run.home.short} ${fmtNum(dist[0].mean)} · ${run.away.short} ${fmtNum(dist[1].mean)} · partido ${fmtNum(dist[2].mean)}`}>
        <div className="grid lg:grid-cols-3 gap-4">
          {dist.map((d) => (
            <BarChartCard key={d.id} title={`${TEAM_STAT_LABEL[k]} · ${d.name}`} data={d.chart} color={d.color} height={180} />
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {dist.map((d) => (
            <DataTable key={d.id} title={`Distribución · ${d.name}`} rows={d.rows} csvName={`${k}-${d.name}-${run.label}`} columns={[{ key: 'label', label: 'Valor', render: (r: FreqRow) => r.label, value: (r: FreqRow) => Number(r.label) }, ...freqColumns<FreqRow>((r) => r, showOdds)]} pageSize={15} />
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          {dist.map((d) => (
            <DataTable key={d.id} title={`Más/menos · ${d.name}`} rows={d.ou} csvName={`ou-${k}-${d.name}-${run.label}`} columns={ouColumns(showOdds)} pageSize={40} />
          ))}
        </div>
      </Section>
    </div>
  );
}
