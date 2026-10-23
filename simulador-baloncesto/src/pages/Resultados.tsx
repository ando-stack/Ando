import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/state';
import type { SimRun } from '../lib/types';
import { COMP_LABEL } from '../lib/types';
import { saveRun } from '../lib/storage';
import { fmtDate, fmtNum, fmtPct } from '../lib/format';
import OddsDisclaimer from '../components/OddsDisclaimer';
import SummaryTab from '../components/results/SummaryTab';
import ScoresTab from '../components/results/ScoresTab';
import PointsTab from '../components/results/PointsTab';
import QuartersTab from '../components/results/QuartersTab';
import TeamStatsTab from '../components/results/TeamStatsTab';
import PlayersTab from '../components/results/PlayersTab';
import type { LineOptions } from '../../engine/markets';

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'marcadores', label: 'Resultados exactos y margen' },
  { id: 'puntos', label: 'Puntos y hándicaps' },
  { id: 'cuartos', label: 'Cuartos y mitades' },
  { id: 'equipo', label: 'Estadísticas de equipo' },
  { id: 'jugadores', label: 'Jugadores' },
] as const;

export default function ResultadosPage({ runOverride }: { runOverride?: SimRun }) {
  const { run: ctxRun, showOdds, setShowOdds } = useApp();
  const run = runOverride ?? ctxRun;
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('resumen');
  const [step, setStep] = useState<0.5 | 1>(1);
  const [range, setRange] = useState<string>('auto');
  const [saved, setSaved] = useState(false);
  const lines: LineOptions = useMemo(() => ({ step, range: range === 'auto' ? null : Number(range), minP: 0.01 }), [step, range]);

  if (!run)
    return (
      <div className="card text-slate-400">
        Aún no hay resultados. Ve al <Link to="/" className="text-acento underline">Simulador</Link>, elige dos equipos y pulsa «Simular».
      </div>
    );
  const a = run.aggregate;
  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-4">
        <div className="mr-auto">
          <div className="text-xs text-slate-400">
            {COMP_LABEL[run.comp]} {run.season} · {a.n.toLocaleString('es-ES')} simulaciones · semilla {run.seed} · {fmtNum(run.elapsedMs / 1000, 2)} s ({run.workers} hilos) ·
            datos del {fmtDate(run.dataGeneratedAt)}
          </div>
          <h1 className="text-xl font-semibold">
            <span className="text-local">{run.home.name}</span> <span className="text-slate-500">vs</span> <span className="text-visitante">{run.away.name}</span>
          </h1>
          <div className="text-sm text-slate-300">
            Victoria local {fmtPct(a.homeWins / a.n)} · visitante {fmtPct(a.awayWins / a.n)} · prórroga {fmtPct(a.overtime / a.n)}
          </div>
          {(run.outs.home.length > 0 || run.outs.away.length > 0) && (
            <div className="text-xs text-slate-500 mt-1">
              Bajas: {run.home.short}: {run.outs.home.join(', ') || 'ninguna'} · {run.away.short}: {run.outs.away.join(', ') || 'ninguna'}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Líneas
            <select value={step} onChange={(e) => setStep(Number(e.target.value) as 0.5 | 1)}>
              <option value={1}>de punto en punto (x,5)</option>
              <option value={0.5}>de 0,5 en 0,5</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Rango
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="auto">automático (1 %–99 %)</option>
              {[5, 10, 15, 20, 30].map((r) => (
                <option key={r} value={r}>
                  ± {r} de la media
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showOdds} onChange={(e) => setShowOdds(e.target.checked)} />
            Cuota justa
          </label>
          {!runOverride && (
            <button
              className="btn"
              type="button"
              disabled={saved}
              onClick={async () => {
                await saveRun(run);
                setSaved(true);
              }}
            >
              {saved ? 'Guardada' : 'Guardar simulación'}
            </button>
          )}
        </div>
      </div>
      {showOdds && <OddsDisclaimer />}
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'tab-active' : 'text-slate-400 hover:text-white'}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'resumen' && <SummaryTab run={run} showOdds={showOdds} lines={lines} />}
      {tab === 'marcadores' && <ScoresTab run={run} showOdds={showOdds} lines={lines} />}
      {tab === 'puntos' && <PointsTab run={run} showOdds={showOdds} lines={lines} />}
      {tab === 'cuartos' && <QuartersTab run={run} showOdds={showOdds} lines={lines} />}
      {tab === 'equipo' && <TeamStatsTab run={run} showOdds={showOdds} lines={lines} />}
      {tab === 'jugadores' && <PlayersTab run={run} showOdds={showOdds} lines={lines} />}
    </div>
  );
}
