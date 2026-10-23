import type { TabProps } from './types';
import { Section, Stat } from './common';
import BarChartCard from '../BarChartCard';
import { histMean, histSd, teamMean } from '../../../engine/markets';
import { MARGIN_OFFSET, TEAM_KEYS } from '../../../engine/aggregate';
import { fmtNum, fmtPct } from '../../lib/format';
import { TEAM_STAT_LABEL } from './labels';
import DataTable from '../DataTable';

export default function SummaryTab({ run }: TabProps) {
  const a = run.aggregate;
  const n = a.n;
  const totalData = a.totalPts.map((c, i) => ({ x: i, pct: c / n, count: c })).filter((d) => d.count > 0);
  const marginData = a.margin.map((c, i) => ({ x: i - MARGIN_OFFSET, pct: c / n, count: c })).filter((d) => d.count > 0);
  const rows = TEAM_KEYS.map((k) => ({ k, h: teamMean(a, 'home', k), aw: teamMean(a, 'away', k), t: teamMean(a, 'match', k) }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={`Victoria ${run.home.short} (local)`} value={fmtPct(a.homeWins / n)} sub={`${a.homeWins.toLocaleString('es-ES')} veces`} color="text-local" />
        <Stat label={`Victoria ${run.away.short} (visitante)`} value={fmtPct(a.awayWins / n)} sub={`${a.awayWins.toLocaleString('es-ES')} veces`} color="text-visitante" />
        <Stat label="Prórroga" value={fmtPct(a.overtime / n)} sub={`${a.overtime.toLocaleString('es-ES')} veces`} />
        <Stat label="Posesiones por equipo" value={fmtNum(a.possSum / n)} />
        <Stat label={`Puntos ${run.home.short}`} value={fmtNum(teamMean(a, 'home', 'pts'))} color="text-local" />
        <Stat label={`Puntos ${run.away.short}`} value={fmtNum(teamMean(a, 'away', 'pts'))} color="text-visitante" />
        <Stat label="Total de puntos" value={fmtNum(histMean(a.totalPts))} sub={`desv. típica ${fmtNum(histSd(a.totalPts))}`} />
        <Stat label="Margen medio (local − visitante)" value={fmtNum(histMean(a.margin, MARGIN_OFFSET))} sub={`desv. típica ${fmtNum(histSd(a.margin, MARGIN_OFFSET))}`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <BarChartCard title="Distribución del total de puntos" data={totalData} refX={Math.round(histMean(a.totalPts))} />
        <BarChartCard title="Distribución del margen (local − visitante)" data={marginData} color="#38bdf8" refX={0} />
      </div>
      <Section title="Medias por partido simulado">
        <DataTable
          rows={rows}
          csvName={`medias-${run.label}`}
          pageSize={30}
          columns={[
            { key: 'k', label: 'Estadística', render: (r) => TEAM_STAT_LABEL[r.k], value: (r) => TEAM_STAT_LABEL[r.k] },
            { key: 'h', label: run.home.short, num: true, render: (r) => fmtNum(r.h), value: (r) => +r.h.toFixed(3) },
            { key: 'a', label: run.away.short, num: true, render: (r) => fmtNum(r.aw), value: (r) => +r.aw.toFixed(3) },
            { key: 't', label: 'Partido', num: true, render: (r) => fmtNum(r.t), value: (r) => +r.t.toFixed(3) },
          ]}
        />
      </Section>
    </div>
  );
}
