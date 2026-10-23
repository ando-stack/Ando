import { useMemo, useState } from 'react';
import { useApp } from '../lib/state';
import { COMP_LABEL, type CompetitionId } from '../lib/types';
import DataTable from '../components/DataTable';
import type { PlayerSnapshot, TeamSeasonStats } from '../../engine/snapshot';
import { fmtDay, fmtNum, fmtPct } from '../lib/format';

const COMPS: CompetitionId[] = ['nba', 'euroleague', 'acb'];

function StatsBlock({ title, s }: { title: string; s: TeamSeasonStats | null }) {
  if (!s) return <div className="card text-sm text-slate-500">{title}: sin partidos</div>;
  const rows: [string, string][] = [
    ['Partidos (G-P)', `${fmtNum(s.gp, 0)} (${fmtNum(s.w, 0)}-${fmtNum(s.l, 0)})`],
    ['Posesiones / partido', fmtNum(s.poss)],
    ['Puntos a favor / en contra', `${fmtNum(s.own.pts)} / ${fmtNum(s.opp.pts)}`],
    ['Eficiencia ofensiva / defensiva (100 pos.)', `${fmtNum(s.ortg)} / ${fmtNum(s.drtg)}`],
    ['T2 (anot./int., %)', `${fmtNum(s.own.fg2m)}/${fmtNum(s.own.fg2a)} · ${fmtPct(s.fg2Pct)}`],
    ['T3 (anot./int., %)', `${fmtNum(s.own.fg3m)}/${fmtNum(s.own.fg3a)} · ${fmtPct(s.fg3Pct)}`],
    ['TL (anot./int., %)', `${fmtNum(s.own.ftm)}/${fmtNum(s.own.fta)} · ${fmtPct(s.ftPct)}`],
    ['Rival T2 % / T3 %', `${fmtPct(s.oppFg2Pct)} / ${fmtPct(s.oppFg3Pct)}`],
    ['Rival T2 / T3 / TL intentados', `${fmtNum(s.opp.fg2a)} / ${fmtNum(s.opp.fg3a)} / ${fmtNum(s.opp.fta)}`],
    ['% rebote ofensivo / defensivo', `${fmtPct(s.orebPct)} / ${fmtPct(s.drebPct)}`],
    ['Rebotes (of. + def.)', `${fmtNum(s.own.oreb)} + ${fmtNum(s.own.dreb)}`],
    ['Asistencias / robos / tapones', `${fmtNum(s.own.ast)} / ${fmtNum(s.own.stl)} / ${fmtNum(s.own.blk)}`],
    ['Pérdidas (propias / forzadas)', `${fmtNum(s.own.tov)} / ${fmtNum(s.opp.tov)}`],
    ['Faltas cometidas / recibidas', `${fmtNum(s.own.pf)} / ${fmtNum(s.own.pfd)}`],
  ];
  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-2 text-sm">{title}</h3>
      <dl className="text-sm grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-400">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function EquiposPage() {
  const { sel, setSel, loaded, loadError, loading } = useApp();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const snap = loaded?.snapshot;
  const team = snap?.teams.find((t) => t.id === teamId) ?? snap?.teams[0];
  const players = useMemo(() => (snap && team ? snap.players.filter((p) => p.teamId === team.id).sort((a, b) => b.mpg - a.mpg || b.mpgPrev - a.mpgPrev) : []), [snap, team]);
  const per = snap?.comp === 'nba' ? 36 : 40;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {COMPS.map((c) => (
          <button key={c} type="button" className={`tab border ${sel.comp === c ? 'tab-active border-acento' : 'border-borde text-slate-400'}`} onClick={() => { setSel({ comp: c, homeId: null, awayId: null, homeSetup: null, awaySetup: null, homeOut: [], awayOut: [] }); setTeamId(null); }}>
            {COMP_LABEL[c]}
          </button>
        ))}
      </div>
      {loading && <div className="card text-slate-400">Cargando…</div>}
      {loadError && <div className="card text-red-300">{loadError}</div>}
      {snap && team && (
        <div className="grid lg:grid-cols-[16rem_1fr] gap-4">
          <div className="card p-2 space-y-2 h-fit">
            <input className="w-full" placeholder="Buscar equipo…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-[70vh] overflow-auto">
              {snap.teams
                .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
                .map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setTeamId(t.id)} className={`w-full text-left px-2 py-1 rounded text-sm hover:bg-slate-800 ${t.id === team.id ? 'bg-slate-800 text-acento' : ''}`}>
                      {t.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          <div className="space-y-4 min-w-0">
            <div className="card">
              <h2 className="text-lg font-semibold text-white">{team.name}</h2>
              <p className="text-xs text-slate-400">
                Mezcla del modelo: temporada {snap.season} ({team.blendWeights.gpCurrent} partidos, peso 1) + {snap.previousSeason} (peso {fmtNum(team.blendWeights.previousWeight, 2)} por
                partido). Fuente: {snap.sources[0]?.name}. Datos generados: {fmtDay(snap.generatedAt)}.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <StatsBlock title={`Temporada ${snap.season}`} s={team.current} />
              <StatsBlock title={`Temporada ${snap.previousSeason}`} s={team.previous} />
              <StatsBlock title="Mezcla usada por el modelo" s={team.blended} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card text-sm">
                <h3 className="font-semibold text-white mb-2">Puntos por cuarto (mezcla)</h3>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      {[1, 2, 3, 4].map((q) => (
                        <th key={q} className="text-right">{q}.º</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>A favor</td>
                      {team.quarters.for.map((v, i) => (
                        <td key={i} className="num">{fmtNum(v)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>En contra</td>
                      {team.quarters.against.map((v, i) => (
                        <td key={i} className="num">{fmtNum(v)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card text-sm">
                <h3 className="font-semibold text-white mb-2">Local y visitante (mezcla)</h3>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th className="text-right">Partidos</th>
                      <th className="text-right">% victorias</th>
                      <th className="text-right">Pts a favor</th>
                      <th className="text-right">Pts en contra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['Local', team.home],
                        ['Visitante', team.away],
                      ] as const
                    ).map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="num">{fmtNum(v.gp, 1)}</td>
                        <td className="num">{fmtPct(v.gp ? v.w / v.gp : NaN)}</td>
                        <td className="num">{fmtNum(v.ptsFor)}</td>
                        <td className="num">{fmtNum(v.ptsAgainst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <DataTable<PlayerSnapshot>
              title={`Plantilla (${players.length}) · tasas por ${per} minutos (mezcla regularizada)`}
              rows={players}
              csvName={`plantilla-${team.short}`}
              search={(p) => p.name}
              pageSize={30}
              columns={[
                { key: 'name', label: 'Jugador', render: (p) => <span>{p.name}{p.estimated && <span className="chip ml-1 border-violet-700 text-violet-300" title={p.estimateNote}>estimado</span>}</span>, value: (p) => p.name },
                { key: 'pos', label: 'Pos', render: (p) => p.position ?? '—', value: (p) => p.position ?? '' },
                { key: 'gp', label: 'PJ', num: true, render: (p) => p.gp, value: (p) => p.gp },
                { key: 'gs', label: 'Tit.', num: true, render: (p) => p.gs, value: (p) => p.gs },
                { key: 'mpg', label: 'Min/PJ', num: true, render: (p) => fmtNum(p.mpg), value: (p) => +p.mpg.toFixed(2) },
                { key: 'gpp', label: 'PJ ant.', num: true, render: (p) => p.gpPrev, value: (p) => p.gpPrev },
                { key: 'mpgp', label: 'Min/PJ ant.', num: true, render: (p) => fmtNum(p.mpgPrev), value: (p) => +p.mpgPrev.toFixed(2) },
                { key: 'usg', label: 'Uso', num: true, render: (p) => fmtPct(p.rates.usage), value: (p) => +(p.rates.usage * 100).toFixed(2) },
                { key: 'pts', label: 'Pts', num: true, render: (p) => fmtNum(p.per36or40.pts), value: (p) => +p.per36or40.pts.toFixed(2) },
                { key: 'fg2a', label: 'T2I', num: true, render: (p) => fmtNum(p.per36or40.fg2a), value: (p) => +p.per36or40.fg2a.toFixed(2) },
                { key: 'fg2', label: 'T2%', num: true, render: (p) => fmtPct(p.rates.fg2Pct), value: (p) => +(p.rates.fg2Pct * 100).toFixed(2) },
                { key: 'fg3a', label: 'T3I', num: true, render: (p) => fmtNum(p.per36or40.fg3a), value: (p) => +p.per36or40.fg3a.toFixed(2) },
                { key: 'fg3', label: 'T3%', num: true, render: (p) => fmtPct(p.rates.fg3Pct), value: (p) => +(p.rates.fg3Pct * 100).toFixed(2) },
                { key: 'fta', label: 'TLI', num: true, render: (p) => fmtNum(p.per36or40.fta), value: (p) => +p.per36or40.fta.toFixed(2) },
                { key: 'ft', label: 'TL%', num: true, render: (p) => fmtPct(p.rates.ftPct), value: (p) => +(p.rates.ftPct * 100).toFixed(2) },
                { key: 'oreb', label: 'RO', num: true, render: (p) => fmtNum(p.per36or40.oreb), value: (p) => +p.per36or40.oreb.toFixed(2) },
                { key: 'dreb', label: 'RD', num: true, render: (p) => fmtNum(p.per36or40.dreb), value: (p) => +p.per36or40.dreb.toFixed(2) },
                { key: 'ast', label: 'Ast', num: true, render: (p) => fmtNum(p.per36or40.ast), value: (p) => +p.per36or40.ast.toFixed(2) },
                { key: 'stl', label: 'Rob', num: true, render: (p) => fmtNum(p.per36or40.stl), value: (p) => +p.per36or40.stl.toFixed(2) },
                { key: 'blk', label: 'Tap', num: true, render: (p) => fmtNum(p.per36or40.blk), value: (p) => +p.per36or40.blk.toFixed(2) },
                { key: 'tov', label: 'Pér', num: true, render: (p) => fmtNum(p.per36or40.tov), value: (p) => +p.per36or40.tov.toFixed(2) },
                { key: 'pf', label: 'FC', num: true, render: (p) => fmtNum(p.per36or40.pf), value: (p) => +p.per36or40.pf.toFixed(2) },
                { key: 'pfd', label: 'FR', num: true, render: (p) => fmtNum(p.per36or40.pfd), value: (p) => +p.per36or40.pfd.toFixed(2) },
                { key: 'q', label: 'Min. por cuarto (%)', render: (p) => p.quarterShare.map((x) => Math.round(x * 100)).join(' · ') + (p.quarterShareSource === 'estimado' ? ' (est.)' : ''), value: (p) => p.quarterShare.map((x) => Math.round(x * 100)).join('/') },
              ]}
            />
            <div className="card text-xs text-slate-400 space-y-1">
              <h3 className="font-semibold text-white text-sm">Bajas y ausencias</h3>
              {snap.injuries.filter((i) => i.teamId === team.id).length === 0 && <p>Ninguna registrada.</p>}
              {snap.injuries
                .filter((i) => i.teamId === team.id)
                .map((i) => (
                  <p key={i.playerName}>
                    <strong className="text-slate-200">{i.playerName}</strong> ({i.status}): {i.detail} — {i.source}, {fmtDay(i.updatedAt)}
                  </p>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
