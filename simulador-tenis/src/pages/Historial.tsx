import { useState } from 'react';
import { Link } from 'react-router-dom';
import { mediaHist, totalHist } from '../../engine/agregacion';
import { Aviso, Boton, Tarjeta } from '../components/ui';
import { entero, fechaHora, num, pct } from '../lib/formato';
import { borrarGuardada, listarGuardadas, type SimulacionGuardada } from '../lib/guardadas';

function metricas(s: SimulacionGuardada): [string, string][] {
  const r = s.resultados;
  const n = r.n;
  const [a, b] = r.jugadores;
  return [
    [`P(gana ${s.a.nombre})`, pct(r.victoriasA / n)],
    [`P(gana ${s.b.nombre})`, pct(1 - r.victoriasA / n)],
    ['Resultado en sets más probable', `${r.resultadoSets[0]?.clave} (${pct((r.resultadoSets[0]?.veces ?? 0) / n)})`],
    ['Marcador exacto más probable', `${r.marcadores[0]?.clave} (${pct((r.marcadores[0]?.veces ?? 0) / n)})`],
    ['Media de juegos', num(mediaHist(r.juegosTotales))],
    ['Media de sets', num(mediaHist(r.numSets))],
    ['P(al menos un tie-break)', pct(r.alMenosUnTiebreak / n)],
    [`Aces ${s.a.nombre}`, num(mediaHist(a.aces))],
    [`Aces ${s.b.nombre}`, num(mediaHist(b.aces))],
    ['Dobles faltas (partido)', num(mediaHist(r.totales.dobles))],
    ['Breaks (partido)', num(mediaHist(r.totales.breaks))],
    ['Simulaciones', entero(totalHist(r.juegosTotales))],
  ];
}

export default function Historial() {
  const [lista, setLista] = useState(listarGuardadas());
  const [sel, setSel] = useState<string[]>([]);
  const elegidas = lista.filter((s) => sel.includes(s.id));
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id].slice(-3)));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Simulaciones guardadas</h1>
      <p className="text-sm text-texto-2">Se guardan en este navegador. Marca hasta tres para compararlas.</p>
      {!lista.length && <Aviso>Todavía no has guardado ninguna simulación.</Aviso>}
      <div className="space-y-2">
        {lista.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-borde bg-superficie px-3 py-2 text-sm">
            <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Comparar ${s.titulo}`} />
            <Link to={`/resultados/${s.id}`} className="flex-1 hover:underline">
              {s.titulo}
            </Link>
            <span className="text-xs text-texto-3">
              {entero(s.n)} sims · {fechaHora(s.fecha)}
            </span>
            <Boton
              onClick={() => {
                borrarGuardada(s.id);
                setLista(listarGuardadas());
              }}
            >
              Borrar
            </Boton>
          </div>
        ))}
      </div>
      {elegidas.length >= 2 && (
        <Tarjeta titulo="Comparación">
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="text-xs text-texto-3">
                  <th className="text-left font-medium">Métrica</th>
                  {elegidas.map((s) => (
                    <th key={s.id} className="px-2 text-right font-medium">
                      {s.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricas(elegidas[0]).map((_, i) => (
                  <tr key={i} className="border-t border-borde/40">
                    <td className="py-1 text-texto-2">{metricas(elegidas[0])[i][0].replace(elegidas[0].a.nombre, 'A').replace(elegidas[0].b.nombre, 'B')}</td>
                    {elegidas.map((s) => (
                      <td key={s.id} className="px-2 text-right">
                        {metricas(s)[i][1]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-texto-3">A = primer jugador y B = segundo jugador de cada simulación.</p>
        </Tarjeta>
      )}
    </div>
  );
}
