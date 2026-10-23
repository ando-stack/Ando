import { useEffect, useState } from 'react';
import { REGLAS } from '../../config/reglas';
import { calibrationInfo, loadSnapshot } from '../lib/data';
import { COMP_LABEL, type CompetitionId } from '../lib/types';
import { fmtDate, fmtDay, fmtNum } from '../lib/format';
import type { CompetitionSnapshot } from '../../engine/snapshot';

const COMPS: CompetitionId[] = ['nba', 'euroleague', 'acb'];

export default function AcercaPage() {
  const [snaps, setSnaps] = useState<Partial<Record<CompetitionId, CompetitionSnapshot | string>>>({});
  useEffect(() => {
    for (const c of COMPS)
      loadSnapshot(c)
        .then((l) => setSnaps((s) => ({ ...s, [c]: l.snapshot })))
        .catch((e) => setSnaps((s) => ({ ...s, [c]: (e as Error).message })));
  }, []);
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="card space-y-2 text-sm">
        <h1 className="text-lg font-semibold text-white">Qué hace</h1>
        <p>
          Simula partidos de la NBA, la EuroLiga y la Liga Endesa posesión a posesión y jugador a jugador (método Monte Carlo). Cada simulación juega el partido completo: reloj,
          rotaciones por cuartos, quién termina cada posesión según su uso, tiros de 2 y de 3 ajustados por la defensa rival, faltas y tiros libres con el bonus de cada
          reglamento, rebotes, asistencias, robos, tapones, prórrogas y una lógica sencilla de final de partido (faltas intencionadas, agotar o acelerar posesiones).
          Repitiéndolo miles de veces se obtiene la distribución completa de resultados.
        </p>
        <p className="text-amber-300">
          Los resultados son probabilidades simuladas a partir de datos históricos, no predicciones seguras. No es asesoramiento de apuestas. Juego responsable, solo mayores de 18 años.
        </p>
      </div>
      <div className="card space-y-3 text-sm">
        <h2 className="font-semibold text-white">Datos y fuentes</h2>
        {COMPS.map((c) => {
          const s = snaps[c];
          return (
            <div key={c} className="border-t border-borde pt-2">
              <h3 className="font-medium text-slate-100">{COMP_LABEL[c]}</h3>
              {typeof s === 'string' && <p className="text-red-300 text-xs">{s}</p>}
              {s && typeof s !== 'string' && (
                <div className="text-xs text-slate-400 space-y-1">
                  <p>
                    Temporadas {s.season} y {s.previousSeason} · {s.league.gamesCurrent} + {s.league.gamesPrevious} partidos · {s.teams.length} equipos · {s.players.length} jugadores ·
                    último partido {fmtDay(s.lastGameDate)} · generado {fmtDate(s.generatedAt)}
                  </p>
                  {s.sources.map((src) => (
                    <p key={src.url}>
                      <a className="underline" href={src.url} target="_blank" rel="noreferrer">
                        {src.name}
                      </a>
                      : {src.terms}
                    </p>
                  ))}
                  {s.notes.length > 0 && (
                    <details>
                      <summary className="cursor-pointer">Notas de la ingesta ({s.notes.length})</summary>
                      <ul className="list-disc ml-5">
                        {s.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="card text-sm overflow-x-auto">
        <h2 className="font-semibold text-white mb-2">Reglas aplicadas (config/reglas.ts)</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              {COMPS.map((c) => (
                <th key={c}>{COMP_LABEL[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Cuartos', (c: CompetitionId) => `${REGLAS[c].periodos} × ${REGLAS[c].duracionPeriodo / 60} min`],
                ['Prórrogas', (c: CompetitionId) => `${REGLAS[c].duracionProrroga / 60} min hasta que haya ganador`],
                ['Eliminación', (c: CompetitionId) => `${REGLAS[c].faltasEliminacion} faltas`],
                ['Reloj de posesión', (c: CompetitionId) => `${REGLAS[c].relojPosesion} s (${REGLAS[c].relojTrasReboteOfensivo} s tras rebote ofensivo)`],
                ['Línea de triple', (c: CompetitionId) => REGLAS[c].lineaTriple],
                ['Bonus', (c: CompetitionId) => REGLAS[c].notas[0]],
                ['Convocados', (c: CompetitionId) => `${REGLAS[c].maxConvocados}`],
              ] as const
            ).map(([l, f]) => (
              <tr key={l}>
                <td className="text-slate-400">{l}</td>
                {COMPS.map((c) => (
                  <td key={c} className="whitespace-normal">{f(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card text-sm overflow-x-auto">
        <h2 className="font-semibold text-white mb-2">Calibración (medias reales frente a simuladas, por equipo y partido)</h2>
        <table>
          <thead>
            <tr>
              <th>Estadística</th>
              {COMPS.map((c) => (
                <th key={c} className="text-right">{COMP_LABEL[c]} real / sim.</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {['poss', 'pts', 'fg2a', 'fg2m', 'fg3a', 'fg3m', 'fta', 'ftm', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'homeMargin', 'marginSd', 'otPct'].map((k) => (
              <tr key={k}>
                <td className="text-slate-400">{k}</td>
                {COMPS.map((c) => {
                  const ci = calibrationInfo(c);
                  return (
                    <td key={c} className="num">
                      {ci ? `${fmtNum(ci.targets[k] ?? NaN, k === 'otPct' ? 3 : 1)} / ${fmtNum(ci.simulated[k] ?? NaN, k === 'otPct' ? 3 : 1)}` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">Validación completa (backtest de la temporada pasada) en docs/validacion.md.</p>
      </div>
    </div>
  );
}
