import { useMemo } from 'react';
import type { CompetitionSnapshot, PlayerSnapshot } from '../../engine/snapshot';
import { defaultTeamSetup, normalizeMinutes, type TeamSetup } from '../../engine/prepare';
import { REGLAS, regulationSeconds } from '../../config/reglas';
import { fmtDay, fmtNum } from '../lib/format';

interface Props {
  snap: CompetitionSnapshot;
  teamId: string;
  setup: TeamSetup;
  out: string[];
  side: 'local' | 'visitante';
  onChange: (setup: TeamSetup, out: string[]) => void;
}

const POS: Record<string, string> = { G: 'Base/Escolta', F: 'Alero/Ala-pívot', C: 'Pívot' };

export default function LineupEditor({ snap, teamId, setup, out, side, onChange }: Props) {
  const rules = REGLAS[snap.comp];
  const regMin = regulationSeconds(rules) / 60;
  const team = snap.teams.find((t) => t.id === teamId)!;
  const lineup = snap.lineups.find((l) => l.teamId === teamId);
  const injuries = snap.injuries.filter((i) => i.teamId === teamId);
  const roster = useMemo(() => snap.players.filter((p) => p.teamId === teamId), [snap, teamId]);
  const byId = useMemo(() => new Map(setup.players.map((p) => [p.id, p])), [setup]);
  const rows = useMemo(() => {
    return [...roster].sort((a, b) => {
      const ma = byId.get(a.id)?.minutes ?? -1;
      const mb = byId.get(b.id)?.minutes ?? -1;
      const sa = byId.get(a.id)?.starter ? 1 : 0;
      const sb = byId.get(b.id)?.starter ? 1 : 0;
      return sb - sa || mb - ma || b.mpg - a.mpg;
    });
  }, [roster, byId]);
  const outSet = new Set(out);
  const starters = setup.players.filter((p) => p.starter).length;
  const total = setup.players.reduce((a, p) => a + p.minutes, 0);
  const dressed = setup.players.filter((p) => p.minutes > 0 || p.starter).length;

  const update = (id: string, patch: Partial<{ minutes: number; starter: boolean }>) => {
    const exists = byId.has(id);
    const players = exists
      ? setup.players.map((p) => (p.id === id ? { ...p, ...patch } : p))
      : [...setup.players, { id, minutes: 0, starter: false, ...patch }];
    onChange({ ...setup, players }, out);
  };
  const toggleOut = (p: PlayerSnapshot) => {
    if (outSet.has(p.id)) {
      onChange(
        { ...setup, players: setup.players.some((x) => x.id === p.id) ? setup.players : [...setup.players, { id: p.id, minutes: 0, starter: false }] },
        out.filter((x) => x !== p.id),
      );
    } else {
      onChange({ ...setup, players: setup.players.filter((x) => x.id !== p.id) }, [...out, p.id]);
    }
  };
  const reset = () => {
    const def = defaultTeamSetup(snap, teamId);
    const defOut = injuries.filter((i) => i.status === 'baja' || i.status === 'ausente-reciente').map((i) => i.playerId!).filter(Boolean);
    onChange(def, defOut);
  };
  const adjust = () => onChange({ ...setup, players: normalizeMinutes(setup.players, regMin).map((p) => ({ ...p, minutes: Math.round(p.minutes * 10) / 10 })) }, out);

  const color = side === 'local' ? 'text-local' : 'text-visitante';
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {team.logo && <img src={team.logo} alt="" className="w-7 h-7 object-contain" referrerPolicy="no-referrer" />}
        <h3 className={`font-semibold ${color}`}>
          {team.name} <span className="text-xs text-slate-400">({side})</span>
        </h3>
        <div className="ml-auto flex gap-2">
          <button className="btn" type="button" onClick={adjust} title={`Escala los minutos para que sumen ${5 * regMin}`}>
            Ajustar minutos
          </button>
          <button className="btn" type="button" onClick={reset}>
            Restablecer
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-400">
          Estado del quinteto
          <select
            value={setup.lineupStatus ?? 'probable'}
            onChange={(e) => onChange({ ...setup, lineupStatus: e.target.value as 'probable' | 'confirmado' }, out)}
            aria-label="Estado del quinteto"
          >
            <option value="probable">probable (calculado)</option>
            <option value="confirmado">confirmado (lo indico yo)</option>
          </select>
        </label>
        {setup.lineupStatus === 'confirmado' && (
          <input
            className="flex-1 min-w-[12rem]"
            placeholder="Fuente de la confirmación (p. ej., acta oficial, club)"
            value={setup.lineupSource ?? ''}
            onChange={(e) => onChange({ ...setup, lineupSource: e.target.value }, out)}
            aria-label="Fuente del quinteto confirmado"
          />
        )}
      </div>
      {lineup && (
        <div className="text-xs text-slate-400 space-y-1">
          <div>
            <span className={`chip mr-2 ${lineup.status === 'confirmado' ? 'border-emerald-600 text-emerald-300' : 'border-sky-700 text-sky-300'}`}>
              Quinteto {lineup.status}
            </span>
            {lineup.basis} Fuente: {lineup.source}. Último partido: {fmtDay(lineup.updatedAt)}.
          </div>
          {lineup.warning && <div className="text-amber-300">⚠ {lineup.warning}</div>}
        </div>
      )}
      <div className="overflow-x-auto -mx-4 px-4">
        <table>
          <thead>
            <tr>
              <th title="Titular">Tit.</th>
              <th>Jugador</th>
              <th>Pos.</th>
              <th className="text-right" title="Partidos y minutos por partido esta temporada (y la anterior)">PJ · Min</th>
              <th title="Minutos en los últimos partidos del equipo (— = no jugó)">Recientes</th>
              <th className="text-right">Min. previstos</th>
              <th title="Marcar como baja">Baja</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = byId.get(p.id);
              const isOut = outSet.has(p.id);
              const inj = injuries.find((i) => i.playerId === p.id);
              return (
                <tr key={p.id} className={isOut ? 'opacity-50' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!s?.starter}
                      disabled={isOut}
                      onChange={(e) => update(p.id, { starter: e.target.checked, minutes: Math.max(s?.minutes ?? 0, e.target.checked ? 20 : 0) })}
                      aria-label={`Titular ${p.name}`}
                    />
                  </td>
                  <td className="max-w-[16rem]">
                    <div className="flex items-center gap-1 flex-wrap">
                      {p.jersey && <span className="text-xs text-slate-500 w-5">{p.jersey}</span>}
                      <span className="text-slate-100">{p.name}</span>
                      {p.estimated && (
                        <span className="chip border-violet-700 text-violet-300" title={p.estimateNote}>
                          estimado
                        </span>
                      )}
                      {inj && (
                        <span
                          className={`chip ${inj.status === 'baja' ? 'border-red-700 text-red-300' : inj.status === 'duda' ? 'border-amber-700 text-amber-300' : 'border-orange-800 text-orange-300'}`}
                          title={`${inj.detail} · Fuente: ${inj.source} · ${fmtDay(inj.updatedAt)}`}
                        >
                          {inj.status === 'ausente-reciente' ? 'ausente' : inj.status}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-xs text-slate-400" title={p.positionRaw ?? (p.position ? POS[p.position] : '')}>
                    {p.position ?? '—'}
                  </td>
                  <td className="num text-xs text-slate-400">
                    {p.gp} · {fmtNum(p.mpg)}
                    {p.gpPrev > 0 && <span className="text-slate-600"> ({p.gpPrev} · {fmtNum(p.mpgPrev)})</span>}
                  </td>
                  <td className="text-xs text-slate-500">{p.recentMinutes.map((m) => (m == null ? '—' : Math.round(m))).join(' ')}</td>
                  <td className="num">
                    <input
                      type="number"
                      className="w-20 text-right"
                      min={0}
                      max={regMin}
                      step={0.5}
                      disabled={isOut}
                      value={s ? s.minutes : 0}
                      onChange={(e) => update(p.id, { minutes: Math.max(0, Math.min(regMin, Number(e.target.value) || 0)) })}
                      aria-label={`Minutos de ${p.name}`}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={isOut} onChange={() => toggleOut(p)} aria-label={`Baja ${p.name}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className={starters === 5 ? 'text-slate-400' : 'text-amber-300'}>Titulares: {starters}/5</span>
        <span className={Math.abs(total - 5 * regMin) < 1 ? 'text-slate-400' : 'text-amber-300'}>
          Minutos: {fmtNum(total)} / {5 * regMin} {Math.abs(total - 5 * regMin) >= 1 ? '(se ajustarán proporcionalmente al simular)' : ''}
        </span>
        <span className={dressed <= rules.maxConvocados ? 'text-slate-400' : 'text-amber-300'}>
          Jugadores con minutos: {dressed} (máx. {rules.maxConvocados} en {rules.nombre})
        </span>
      </div>
      {injuries.length > 0 && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer">Bajas y ausencias ({injuries.length})</summary>
          <ul className="mt-2 space-y-1">
            {injuries.map((i) => (
              <li key={i.playerName}>
                <strong className="text-slate-300">{i.playerName}</strong>: {i.detail} <span className="text-slate-500">— {i.source}, {fmtDay(i.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
