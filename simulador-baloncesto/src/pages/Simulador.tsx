import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/state';
import TeamPicker from '../components/TeamPicker';
import LineupEditor from '../components/LineupEditor';
import ProgressBar from '../components/ProgressBar';
import { buildGameInput, type TeamSetup } from '../../engine/prepare';
import { paramsFor } from '../lib/data';
import { runParallel, workerCount, type RunHandle } from '../lib/simulator';
import { COMP_LABEL, type CompetitionId, type SimRun } from '../lib/types';
import { fmtDate, fmtDay, fmtInt } from '../lib/format';
import { REGLAS } from '../../config/reglas';

const COMPS: CompetitionId[] = ['nba', 'euroleague', 'acb'];

export default function SimuladorPage() {
  const { sel, setSel, loaded, loadError, loading, pickTeam, setRun } = useApp();
  const nav = useNavigate();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<RunHandle | null>(null);
  const snap = loaded?.snapshot ?? null;
  const rules = REGLAS[sel.comp];
  const nValid = Number.isFinite(sel.n) && sel.n >= 1000 && sel.n <= 100000;

  const changeComp = (c: CompetitionId) => {
    if (c === sel.comp) return;
    setSel({ comp: c, homeId: null, awayId: null, homeSetup: null, awaySetup: null, homeOut: [], awayOut: [] });
    setError(null);
  };

  const simulate = async () => {
    if (!snap || !sel.homeId || !sel.awayId || !sel.homeSetup || !sel.awaySetup) return;
    setError(null);
    const clean = (s: TeamSetup, out: string[]): TeamSetup => ({ ...s, players: s.players.filter((p) => !out.includes(p.id)) });
    const home = clean(sel.homeSetup, sel.homeOut);
    const away = clean(sel.awaySetup, sel.awayOut);
    for (const [s, name] of [
      [home, 'local'],
      [away, 'visitante'],
    ] as const) {
      if (s.players.filter((p) => p.minutes > 0 || p.starter).length < 5) {
        setError(`El equipo ${name} necesita al menos 5 jugadores con minutos.`);
        return;
      }
    }
    const { params } = paramsFor(sel.comp);
    const input = buildGameInput(snap, home, away, params);
    setRunning(true);
    setProgress(0);
    setElapsed(null);
    const t0 = performance.now();
    const h = runParallel(input, sel.n, sel.seed, (d) => setProgress(d));
    handle.current = h;
    try {
      const agg = await h.promise;
      const ms = performance.now() - t0;
      setElapsed(ms);
      const ht = snap.teams.find((t) => t.id === sel.homeId)!;
      const at = snap.teams.find((t) => t.id === sel.awayId)!;
      const name = (id: string) => snap.players.find((p) => p.id === id)?.name ?? id;
      const run: SimRun = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        label: `${ht.short} - ${at.short}`,
        comp: sel.comp,
        season: snap.season,
        dataGeneratedAt: snap.generatedAt,
        home: { id: ht.id, name: ht.name, short: ht.short },
        away: { id: at.id, name: at.name, short: at.short },
        n: agg.n,
        seed: sel.seed,
        elapsedMs: ms,
        workers: Math.min(workerCount(), Math.max(1, Math.floor(sel.n / 500))),
        setups: { home, away },
        outs: { home: sel.homeOut.map(name), away: sel.awayOut.map(name) },
        aggregate: agg,
      };
      setRun(run);
      nav('/resultados');
    } catch (e) {
      if ((e as Error).message) setError((e as Error).message);
    } finally {
      setRunning(false);
      handle.current = null;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Competición">
        {COMPS.map((c) => (
          <button key={c} role="tab" aria-selected={sel.comp === c} className={`tab border ${sel.comp === c ? 'tab-active border-acento' : 'border-borde text-slate-400 hover:text-white'}`} onClick={() => changeComp(c)} type="button">
            {COMP_LABEL[c]}
          </button>
        ))}
      </div>

      {loading && <div className="card text-slate-400">Cargando datos de {COMP_LABEL[sel.comp]}…</div>}
      {loadError && (
        <div className="card border-red-800 text-red-300">
          <p className="font-medium">No hay datos disponibles de {COMP_LABEL[sel.comp]}.</p>
          <p className="text-sm mt-1">{loadError}</p>
        </div>
      )}

      {snap && (
        <>
          <div className="card text-xs text-slate-400 space-y-1">
            {loaded?.warning && <p className="text-amber-300">⚠ {loaded.warning}</p>}
            <p>
              <strong className="text-slate-200">{COMP_LABEL[snap.comp]} {snap.season}</strong> · {snap.teams.length} equipos · {snap.players.length} jugadores ·
              último partido incluido: {fmtDay(snap.lastGameDate)} · datos generados: {fmtDate(snap.generatedAt)} · {snap.league.gamesCurrent} partidos de esta
              temporada y {snap.league.gamesPrevious} de la {snap.previousSeason} (ponderada).
            </p>
            <p>Fuente: {snap.sources.map((s) => s.name).join(' · ')}</p>
            <p>
              Reglas: {rules.periodos} cuartos de {rules.duracionPeriodo / 60} min, prórrogas de {rules.duracionProrroga / 60} min, eliminación con{' '}
              {rules.faltasEliminacion} faltas, reloj de {rules.relojPosesion} s, triple a {rules.lineaTriple}. {rules.notas[0]}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <TeamPicker label="Equipo local" color="local" teams={snap.teams} value={sel.homeId} exclude={sel.awayId} onChange={(id) => pickTeam('home', id)} />
            <TeamPicker label="Equipo visitante" color="visitante" teams={snap.teams} value={sel.awayId} exclude={sel.homeId} onChange={(id) => pickTeam('away', id)} />
          </div>

          <div className="card flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="nsims">
                Número de simulaciones (1.000 – 100.000)
              </label>
              <input id="nsims" type="number" min={1000} max={100000} step={1000} value={sel.n} onChange={(e) => setSel({ n: Math.round(Number(e.target.value)) })} className={`w-40 ${nValid ? '' : 'border-red-600'}`} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1" htmlFor="seed">
                Semilla
              </label>
              <input id="seed" type="number" value={sel.seed} onChange={(e) => setSel({ seed: Math.abs(Math.round(Number(e.target.value))) || 1 })} className="w-36" />
            </div>
            <button type="button" className="btn btn-primary" disabled={!sel.homeId || !sel.awayId || running || !nValid} onClick={simulate}>
              {running ? 'Simulando…' : 'Simular'}
            </button>
            {running && (
              <button type="button" className="btn" onClick={() => handle.current?.cancel()}>
                Cancelar
              </button>
            )}
            <div className="flex-1 min-w-[12rem] space-y-1">
              {(running || elapsed != null) && (
                <>
                  <ProgressBar value={progress} max={sel.n} />
                  <div className="text-xs text-slate-400">
                    {fmtInt(progress)} / {fmtInt(sel.n)} simulaciones
                    {elapsed != null && ` · ${(elapsed / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s`} · {workerCount()} hilos
                  </div>
                </>
              )}
            </div>
          </div>
          {error && <div className="card border-red-800 text-red-300 text-sm">{error}</div>}

          <div className="grid xl:grid-cols-2 gap-4">
            {sel.homeId && sel.homeSetup && (
              <LineupEditor snap={snap} teamId={sel.homeId} setup={sel.homeSetup} out={sel.homeOut} side="local" onChange={(s, o) => setSel({ homeSetup: s, homeOut: o })} />
            )}
            {sel.awayId && sel.awaySetup && (
              <LineupEditor snap={snap} teamId={sel.awayId} setup={sel.awaySetup} out={sel.awayOut} side="visitante" onChange={(s, o) => setSel({ awaySetup: s, awayOut: o })} />
            )}
          </div>
          {(!sel.homeId || !sel.awayId) && <p className="text-sm text-slate-500">Elige el equipo local y el visitante para ver sus quintetos y rotaciones.</p>}
        </>
      )}
    </div>
  );
}
