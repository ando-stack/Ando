import { useMemo, useState } from 'react';
import type { TabProps } from './types';
import { Section } from './common';
import DataTable, { type Column } from '../DataTable';
import BarChartCard from '../BarChartCard';
import { countOver, playerMean } from '../../../engine/markets';
import type { PlayerAgg, PlayerKey } from '../../../engine/aggregate';
import { PLAYER_LINE_KEYS, PLAYER_STAT_LABEL } from './labels';
import { fmtNum, fmtOdds, fmtPct } from '../../lib/format';

interface Row {
  i: number;
  p: PlayerAgg;
  team: string;
}

const SUMMARY_KEYS: { k: PlayerKey; label: string }[] = [
  { k: 'min', label: 'Min' },
  { k: 'pts', label: 'Pts' },
  { k: 'reb', label: 'Reb' },
  { k: 'oreb', label: 'RO' },
  { k: 'dreb', label: 'RD' },
  { k: 'ast', label: 'Ast' },
  { k: 'stl', label: 'Rob' },
  { k: 'blk', label: 'Tap' },
  { k: 'tov', label: 'Pér' },
  { k: 'fg3m', label: '3PM' },
  { k: 'fg3a', label: '3PA' },
  { k: 'ftm', label: 'TLM' },
  { k: 'fg2m', label: 'T2M' },
  { k: 'pf', label: 'FC' },
  { k: 'pfd', label: 'FR' },
  { k: 'pra', label: 'P+R+A' },
  { k: 'pr', label: 'P+R' },
  { k: 'pa', label: 'P+A' },
  { k: 'ra', label: 'R+A' },
  { k: 'sb', label: 'R+T' },
];

export default function PlayersTab({ run, showOdds }: TabProps) {
  const a = run.aggregate;
  const n = a.n;
  const teamName = (side: 0 | 1) => (side === 0 ? run.home.short : run.away.short);
  const rows: Row[] = useMemo(() => a.players.map((p, i) => ({ i, p, team: teamName(p.side) })), [a]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamOptions = [
    { value: run.home.short, label: run.home.name },
    { value: run.away.short, label: run.away.name },
  ];
  const [k, setK] = useState<PlayerKey>('pts');
  const [chartPlayer, setChartPlayer] = useState(0);

  const byMean = (key: PlayerKey) => [...rows].sort((x, y) => playerMean(a, y.i, key) - playerMean(a, x.i, key));
  const nameCols: Column<Row>[] = [
    { key: 'name', label: 'Jugador', render: (r) => <span className={r.p.side === 0 ? 'text-local' : 'text-visitante'}>{r.p.name}</span>, value: (r) => r.p.name },
    { key: 'team', label: 'Equipo', render: (r) => r.team, value: (r) => r.team },
  ];
  const probCell = (c: number) => (
    <span>
      {fmtPct(c / n)}
      {showOdds && c > 0 ? <span className="text-slate-500"> · {fmtOdds(c / n)}</span> : null}
    </span>
  );

  // Líneas: columnas 0,5 … hasta la línea máxima en la que algún jugador supera el 1 %
  const lineCols = useMemo(() => {
    let maxLine = 0.5;
    for (const r of rows) {
      const h = r.p.hist[k];
      for (let line = 0.5; line < h.length; line += 1) if (countOver(h, line) / n >= 0.01) maxLine = Math.max(maxLine, line);
    }
    const step = maxLine > 40 ? 5 : maxLine > 20 ? 2 : 1;
    const ls: number[] = [];
    for (let l = 0.5; l <= maxLine + 1e-9; l += step) ls.push(l);
    return ls;
  }, [rows, k, n]);

  const summaryCols: Column<Row>[] = [
    ...nameCols,
    ...SUMMARY_KEYS.map(({ k: key, label }) => ({
      key,
      label,
      num: true,
      render: (r: Row) => fmtNum(playerMean(a, r.i, key)),
      value: (r: Row) => Math.round(playerMean(a, r.i, key) * 1000) / 1000,
    })),
    { key: 'dd', label: 'Doble-doble', num: true, render: (r) => probCell(r.p.doubleDouble), value: (r) => Math.round((r.p.doubleDouble / n) * 1e5) / 1e3 },
    { key: 'td', label: 'Triple-doble', num: true, render: (r) => probCell(r.p.tripleDouble), value: (r) => Math.round((r.p.tripleDouble / n) * 1e5) / 1e3 },
    { key: 'fo', label: 'Eliminado', num: true, render: (r) => probCell(r.p.fouledOut), value: (r) => Math.round((r.p.fouledOut / n) * 1e5) / 1e3 },
  ];
  const lineTableCols: Column<Row>[] = [
    ...nameCols,
    { key: 'mean', label: 'Media', num: true, render: (r) => fmtNum(playerMean(a, r.i, k), 2), value: (r) => Math.round(playerMean(a, r.i, k) * 1000) / 1000 },
    ...lineCols.map((l) => ({
      key: `l${l}`,
      label: `+${l.toLocaleString('es-ES', { minimumFractionDigits: 1 })}`,
      num: true,
      render: (r: Row) => probCell(countOver(r.p.hist[k], l)),
      value: (r: Row) => Math.round((countOver(r.p.hist[k], l) / n) * 1e5) / 1e3,
    })),
  ];
  const leaderRows = (f: 'topScorer' | 'topRebounder' | 'topAssister') => [...rows].filter((r) => r.p[f] > 0).sort((x, y) => y.p[f] - x.p[f]);
  const leaderCols = (f: 'topScorer' | 'topRebounder' | 'topAssister'): Column<Row>[] => [
    ...nameCols,
    { key: 'veces', label: 'Veces', num: true, render: (r) => fmtNum(r.p[f], 1), value: (r) => Math.round(r.p[f] * 10) / 10 },
    { key: 'p', label: '%', num: true, render: (r) => probCell(r.p[f]), value: (r) => Math.round((r.p[f] / n) * 1e5) / 1e3 },
  ];
  const sorted = (f: 'doubleDouble' | 'tripleDouble' | 'fouledOut') => [...rows].sort((x, y) => y.p[f] - x.p[f]);
  const cp = rows[chartPlayer] ?? rows[0];
  return (
    <div className="space-y-8">
      <Section title="Medias por jugador" desc="Media por simulación. Ordenado por puntos; pulsa una cabecera para ordenar por otra columna. Filtra por equipo o usa la lista conjunta.">
        <DataTable rows={byMean('pts')} columns={summaryCols} csvName={`jugadores-medias-${run.label}`} search={(r) => r.p.name} teamOf={(r) => r.team} teamOptions={teamOptions} pageSize={30} />
      </Section>

      <Section title="Probabilidad de superar cada línea" desc="Porcentaje de simulaciones en las que el jugador supera la línea (por ejemplo, +9,5 puntos = 10 o más).">
        <div className="flex flex-wrap gap-1">
          {PLAYER_LINE_KEYS.map((x) => (
            <button key={x} type="button" className={`tab ${k === x ? 'tab-active' : 'text-slate-400'}`} onClick={() => setK(x)}>
              {PLAYER_STAT_LABEL[x]}
            </button>
          ))}
        </div>
        <DataTable title={PLAYER_STAT_LABEL[k]} rows={byMean(k)} columns={lineTableCols} csvName={`jugadores-lineas-${k}-${run.label}`} search={(r) => r.p.name} teamOf={(r) => r.team} teamOptions={teamOptions} pageSize={30} />
        {cp && (
          <div className="space-y-2">
            <select value={chartPlayer} onChange={(e) => setChartPlayer(Number(e.target.value))} aria-label="Jugador del gráfico">
              {rows.map((r, idx) => (
                <option key={r.p.id} value={idx}>
                  {r.p.name} ({r.team})
                </option>
              ))}
            </select>
            <BarChartCard
              title={`${PLAYER_STAT_LABEL[k]} · ${cp.p.name}`}
              data={cp.p.hist[k].map((c, v) => ({ x: v, pct: c / n, count: c })).filter((d) => d.count > 0)}
              color={cp.p.side === 0 ? '#38bdf8' : '#f472b6'}
            />
          </div>
        )}
      </Section>

      <Section title="Máximos del partido" desc="Probabilidad de ser el máximo anotador, reboteador o asistente del partido (los empates se reparten a partes iguales).">
        <div className="grid lg:grid-cols-3 gap-4">
          <DataTable title="Máximo anotador" rows={leaderRows('topScorer')} columns={leaderCols('topScorer')} csvName={`max-anotador-${run.label}`} teamOf={(r) => r.team} teamOptions={teamOptions} pageSize={10} />
          <DataTable title="Máximo reboteador" rows={leaderRows('topRebounder')} columns={leaderCols('topRebounder')} csvName={`max-reboteador-${run.label}`} teamOf={(r) => r.team} teamOptions={teamOptions} pageSize={10} />
          <DataTable title="Máximo asistente" rows={leaderRows('topAssister')} columns={leaderCols('topAssister')} csvName={`max-asistente-${run.label}`} teamOf={(r) => r.team} teamOptions={teamOptions} pageSize={10} />
        </div>
      </Section>

      <Section title="Dobles-dobles, triples-dobles y eliminación por faltas">
        <div className="grid lg:grid-cols-3 gap-4">
          {(
            [
              ['doubleDouble', 'Doble-doble'],
              ['tripleDouble', 'Triple-doble'],
              ['fouledOut', 'Eliminado por faltas'],
            ] as const
          ).map(([f, label]) => (
            <DataTable
              key={f}
              title={label}
              rows={sorted(f)}
              columns={[...nameCols, { key: 'v', label: 'Veces', num: true, render: (r) => r.p[f].toLocaleString('es-ES'), value: (r) => r.p[f] }, { key: 'p', label: '%', num: true, render: (r) => probCell(r.p[f]), value: (r) => Math.round((r.p[f] / n) * 1e5) / 1e3 }]}
              csvName={`${f}-${run.label}`}
              teamOf={(r) => r.team}
              teamOptions={teamOptions}
              pageSize={10}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}
