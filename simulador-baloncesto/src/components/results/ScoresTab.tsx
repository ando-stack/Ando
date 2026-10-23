import type { TabProps } from './types';
import { Section, freqColumns } from './common';
import DataTable from '../DataTable';
import BarChartCard from '../BarChartCard';
import { exactScores, marginBuckets, marginPointByPoint, type FreqRow } from '../../../engine/markets';
import { MARGIN_OFFSET } from '../../../engine/aggregate';
import { useMemo, useState } from 'react';

export default function ScoresTab({ run, showOdds }: TabProps) {
  const a = run.aggregate;
  const [width, setWidth] = useState(5);
  const scores = useMemo(() => exactScores(a), [a]);
  const buckets = useMemo(() => marginBuckets(a, run.home.short, run.away.short, width), [a, run, width]);
  const ppp = useMemo(() => marginPointByPoint(a, run.home.short, run.away.short), [a, run]);
  const labelCol = (title: string) => ({ key: 'label', label: title, render: (r: FreqRow) => r.label, value: (r: FreqRow) => r.label });
  const marginData = a.margin.map((c, i) => ({ x: i - MARGIN_OFFSET, pct: c / a.n, count: c })).filter((d) => d.count > 0);
  return (
    <div className="space-y-6">
      <Section title="Resultados exactos" desc={`Todos los marcadores que han salido (${scores.length}), de más a menos frecuentes. Formato local-visitante; incluye prórrogas.`}>
        <DataTable rows={scores} csvName={`resultados-exactos-${run.label}`} search={(r) => r.label} columns={[labelCol(`${run.home.short}-${run.away.short}`), ...freqColumns<FreqRow>((r) => r, showOdds)]} />
      </Section>
      <Section title="Margen de victoria">
        <BarChartCard title="Margen final (local − visitante)" data={marginData} color="#38bdf8" refX={0} />
        <div className="grid lg:grid-cols-2 gap-4">
          <DataTable
            title="Por tramos"
            rows={buckets}
            csvName={`margen-tramos-${run.label}`}
            extra={
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Ancho del tramo">
                {[3, 5, 10].map((w) => (
                  <option key={w} value={w}>
                    tramos de {w}
                  </option>
                ))}
              </select>
            }
            columns={[labelCol('Margen'), ...freqColumns<FreqRow>((r) => r, showOdds)]}
          />
          <DataTable title="Punto a punto" rows={ppp} csvName={`margen-exacto-${run.label}`} search={(r) => r.label} columns={[labelCol('Margen'), ...freqColumns<FreqRow>((r) => r, showOdds)]} />
        </div>
      </Section>
    </div>
  );
}
