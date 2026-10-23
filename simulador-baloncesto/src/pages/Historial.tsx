import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteRun, listRuns } from '../lib/storage';
import { useApp } from '../lib/state';
import { COMP_LABEL, type SimRun } from '../lib/types';
import { fmtDate, fmtNum, fmtPct } from '../lib/format';
import { histMean, playerMean } from '../../engine/markets';
import { MARGIN_OFFSET } from '../../engine/aggregate';

function Compare({ a, b }: { a: SimRun; b: SimRun }) {
  const rows: [string, (r: SimRun) => number, 'pct' | 'num'][] = [
    [`Victoria local`, (r) => r.aggregate.homeWins / r.aggregate.n, 'pct'],
    [`Victoria visitante`, (r) => r.aggregate.awayWins / r.aggregate.n, 'pct'],
    ['Prórroga', (r) => r.aggregate.overtime / r.aggregate.n, 'pct'],
    ['Puntos local', (r) => r.aggregate.home.sum.pts / r.aggregate.n, 'num'],
    ['Puntos visitante', (r) => r.aggregate.away.sum.pts / r.aggregate.n, 'num'],
    ['Total de puntos', (r) => histMean(r.aggregate.totalPts), 'num'],
    ['Margen medio (local − visitante)', (r) => histMean(r.aggregate.margin, MARGIN_OFFSET), 'num'],
    ['Posesiones', (r) => r.aggregate.possSum / r.aggregate.n, 'num'],
  ];
  const fmt = (v: number, t: 'pct' | 'num') => (t === 'pct' ? fmtPct(v) : fmtNum(v));
  const diff = (v: number, t: 'pct' | 'num') => (v > 0 ? '+' : '') + (t === 'pct' ? fmtNum(v * 100, 1) + ' pp' : fmtNum(v));
  const players = useMemo(() => {
    const ids = new Set([...a.aggregate.players.map((p) => p.id), ...b.aggregate.players.map((p) => p.id)]);
    return [...ids].map((id) => {
      const ia = a.aggregate.players.findIndex((p) => p.id === id);
      const ib = b.aggregate.players.findIndex((p) => p.id === id);
      const name = (ia >= 0 ? a.aggregate.players[ia] : b.aggregate.players[ib]).name;
      const m = (r: SimRun, i: number, k: 'pts' | 'reb' | 'ast' | 'min') => (i >= 0 ? playerMean(r.aggregate, i, k) : 0);
      return { id, name, pa: m(a, ia, 'pts'), pb: m(b, ib, 'pts'), ma: m(a, ia, 'min'), mb: m(b, ib, 'min'), ra: m(a, ia, 'reb'), rb: m(b, ib, 'reb'), aa: m(a, ia, 'ast'), ab: m(b, ib, 'ast') };
    }).sort((x, y) => Math.abs(y.pb - y.pa) - Math.abs(x.pb - x.pa));
  }, [a, b]);
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-white mb-2">Comparación: A = {a.label} ({fmtDate(a.createdAt)}) · B = {b.label} ({fmtDate(b.createdAt)})</h3>
        <p className="text-xs text-slate-400 mb-2">Bajas A: {[...a.outs.home, ...a.outs.away].join(', ') || 'ninguna'} · Bajas B: {[...b.outs.home, ...b.outs.away].join(', ') || 'ninguna'}</p>
        <table>
          <thead>
            <tr>
              <th>Indicador</th>
              <th className="text-right">A</th>
              <th className="text-right">B</th>
              <th className="text-right">B − A</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([l, f, t]) => (
              <tr key={l}>
                <td>{l}</td>
                <td className="num">{fmt(f(a), t)}</td>
                <td className="num">{fmt(f(b), t)}</td>
                <td className="num">{diff(f(b) - f(a), t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <h3 className="font-semibold text-white mb-2">Jugadores (ordenado por mayor cambio en puntos)</h3>
        <table>
          <thead>
            <tr>
              <th>Jugador</th>
              <th className="text-right">Min A</th>
              <th className="text-right">Min B</th>
              <th className="text-right">Pts A</th>
              <th className="text-right">Pts B</th>
              <th className="text-right">Δ Pts</th>
              <th className="text-right">Reb A / B</th>
              <th className="text-right">Ast A / B</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">{fmtNum(p.ma)}</td>
                <td className="num">{fmtNum(p.mb)}</td>
                <td className="num">{fmtNum(p.pa)}</td>
                <td className="num">{fmtNum(p.pb)}</td>
                <td className="num">{(p.pb - p.pa > 0 ? '+' : '') + fmtNum(p.pb - p.pa)}</td>
                <td className="num">{fmtNum(p.ra)} / {fmtNum(p.rb)}</td>
                <td className="num">{fmtNum(p.aa)} / {fmtNum(p.ab)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HistorialPage() {
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const { setRun } = useApp();
  const nav = useNavigate();
  const refresh = () => listRuns().then(setRuns);
  useEffect(() => {
    refresh();
  }, []);
  const chosen = sel.map((id) => runs.find((r) => r.id === id)).filter(Boolean) as SimRun[];
  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-semibold text-white">Simulaciones guardadas</h1>
        <p className="text-xs text-slate-400">Se guardan en este navegador (IndexedDB) y, si Supabase está configurado, también en la tabla saved_simulations. Marca dos para compararlas (por ejemplo, con y sin un jugador lesionado).</p>
      </div>
      {runs.length === 0 && <div className="card text-slate-400 text-sm">No hay simulaciones guardadas. Pulsa «Guardar simulación» en Resultados.</div>}
      {runs.length > 0 && (
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Comparar</th>
                <th>Fecha</th>
                <th>Competición</th>
                <th>Partido</th>
                <th className="text-right">Simulaciones</th>
                <th className="text-right">Local / visitante</th>
                <th>Bajas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id].slice(-2) : s.filter((x) => x !== r.id)))} aria-label={`Comparar ${r.label}`} />
                  </td>
                  <td className="text-xs">{fmtDate(r.createdAt)}</td>
                  <td className="text-xs">{COMP_LABEL[r.comp]}</td>
                  <td>{r.home.name} – {r.away.name}</td>
                  <td className="num">{r.n.toLocaleString('es-ES')}</td>
                  <td className="num">{fmtPct(r.aggregate.homeWins / r.aggregate.n)} / {fmtPct(r.aggregate.awayWins / r.aggregate.n)}</td>
                  <td className="text-xs text-slate-400 max-w-[14rem] truncate" title={[...r.outs.home, ...r.outs.away].join(', ')}>{[...r.outs.home, ...r.outs.away].join(', ') || '—'}</td>
                  <td className="space-x-2">
                    <button type="button" className="btn" onClick={() => { setRun(r); nav('/resultados'); }}>Abrir</button>
                    <button type="button" className="btn" onClick={async () => { await deleteRun(r.id); setSel((s) => s.filter((x) => x !== r.id)); refresh(); }}>Borrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chosen.length === 2 && <Compare a={chosen[0]} b={chosen[1]} />}
    </div>
  );
}
