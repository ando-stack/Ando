import { Link } from 'react-router-dom';
import { NOMBRE_SUPERFICIE, type Superficie } from '../../config/formatos';
import { ratingCombinado } from '../../engine/elo';
import { I, estimarJugador, type ParamsModelo, type VectorStats } from '../../engine/modelo';
import { edad, fechaCorta, pct } from '../lib/formato';
import type { FichaJugador } from '../lib/tiposDatos';
import { Bandera, EtiquetaEstimado } from './ui';

const r = (a: number, b: number) => (b > 0 ? a / b : NaN);
const p = (x: number) => (Number.isFinite(x) ? pct(x) : '—');

export function estadisticasLegibles(v: VectorStats) {
  return {
    saque: r(v[I.won1] + v[I.won2], v[I.svpt]),
    primeros: r(v[I.in1], v[I.svpt]),
    ganados1: r(v[I.won1], v[I.in1]),
    ganados2: r(v[I.won2], v[I.svpt] - v[I.in1]),
    aces: r(v[I.ace], v[I.svpt]),
    dobles: r(v[I.df], v[I.svpt]),
    bpSalvados: r(v[I.bps], v[I.bpf]),
    resto: r(v[I.rwon], v[I.rpt]),
    breaks: r(v[I.brk], v[I.rgms]),
    tiebreaks: r(v[I.tbw], v[I.tbp]),
    juegosSaque: r(v[I.svgms] - (v[I.bpf] - v[I.bps]), v[I.svgms]),
  };
}

export function FichaPrevia({ f, sup, M, rival, color }: { f: FichaJugador; sup: Superficie; M: ParamsModelo; rival?: string; color: string }) {
  const j = f.perfil;
  const est = estimarJugador(j, sup, M);
  const s = estadisticasLegibles(j.stats[sup]);
  // Estimación del modelo frente a un rival de su mismo nivel (mismo Elo): comparable con «Real».
  const z = (est.eloCombinado - 1500) / 100;
  const pr = M.prior[j.pool];
  const media = M.medias[j.pool][sup].saque;
  const saqueModelo = media + est.exSaque - (pr.resto.a + pr.resto.b * z);
  const restoModelo = 1 - media + est.exResto - (pr.saque.a + pr.saque.b * z);
  const forma = f.partidos.slice(0, 10);
  const h2h = rival ? f.partidos.filter((x) => x.o === rival) : [];
  const ed = edad(j.nacimiento);
  const eloEstimado = (j as { eloEstimado?: boolean }).eloEstimado;
  return (
    <div className="space-y-2 rounded-xl border bg-superficie p-3 text-sm" style={{ borderColor: color }}>
      <div className="flex flex-wrap items-center gap-2">
        <Bandera pais={j.pais} />
        <Link to={`/jugador/${j.id}`} className="font-semibold hover:underline">
          {j.nombre}
        </Link>
        <EtiquetaEstimado n={j.nReal.todas} minimo={M.minPartidosReales} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-texto-2">
        <span>Ranking: {j.ranking ? `#${j.ranking.pos} (${j.ranking.fuente}, ${fechaCorta(j.ranking.fecha)})` : 'sin ranking'}</span>
        <span>
          {ed !== null ? `${ed} años` : 'Edad no disponible'} · mano {j.mano === 'L' ? 'zurda' : j.mano === 'R' ? 'diestra' : 'n/d'} · revés n/d
        </span>
        <span>
          Elo general {j.elo.g} {eloEstimado && <span className="text-aviso">(estimado por ranking)</span>}
        </span>
        <span>
          Elo {NOMBRE_SUPERFICIE[sup].toLowerCase()} {j.elo.s[sup]} · combinado {Math.round(ratingCombinado(j.elo, sup, M.pesoSuperficieElo))}
        </span>
      </div>
      <table className="num w-full text-xs">
        <thead>
          <tr className="text-texto-3">
            <th className="text-left font-medium">En {NOMBRE_SUPERFICIE[sup].toLowerCase()} ({j.nReal[sup]} partidos)</th>
            <th className="text-right font-medium">Real</th>
            <th className="text-right font-medium">Modelo</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Puntos ganados al saque', s.saque, saqueModelo],
              ['% primeros', s.primeros, est.primeros],
              ['Ganados con el 1.º', s.ganados1, est.ganados1],
              ['Ganados con el 2.º (dentro)', r(j.stats[sup][I.won2], j.stats[sup][I.svpt] - j.stats[sup][I.in1] - j.stats[sup][I.df]), est.ganados2],
              ['Aces por punto', s.aces, est.aces],
              ['Dobles faltas por 2.º saque', r(j.stats[sup][I.df], j.stats[sup][I.svpt] - j.stats[sup][I.in1]), est.dobles],
              ['Puntos ganados al resto', s.resto, restoModelo],
              ['Break points salvados', s.bpSalvados, NaN],
              ['Juegos al resto ganados', s.breaks, NaN],
              ['Tie-breaks ganados', s.tiebreaks, NaN],
            ] as [string, number, number][]
          ).map(([t, a, b]) => (
            <tr key={t} className="border-t border-borde/40">
              <td className="py-0.5 text-texto-2">{t}</td>
              <td className="text-right">{p(a)}</td>
              <td className="text-right text-texto-2">{p(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-texto-3">«Real»: media ponderada (más peso a lo reciente) de los partidos con estadísticas. «Modelo»: estimación tras ajustar por rivales y regularizar; saque y resto, frente a un rival de su mismo nivel (Elo).</p>
      <div className="text-xs">
        <span className="text-texto-3">Forma (últimos {forma.length}): </span>
        {forma.map((x, i) => (
          <span key={i} title={`${x.f} ${x.t} ${x.r} vs ${x.on}: ${x.m}`} className={`mr-0.5 inline-block w-4 rounded text-center text-[10px] font-bold ${x.g ? 'bg-ok/30 text-ok' : 'bg-error/30 text-error'}`}>
            {x.g ? 'V' : 'D'}
          </span>
        ))}
        {!forma.length && <span className="text-texto-3">sin partidos recientes</span>}
        <span className="ml-2 text-texto-3">Residuo de forma vs Elo: {j.forma > 0 ? '+' : ''}{j.forma.toFixed(2)}</span>
      </div>
      {rival && (
        <div className="text-xs">
          <span className="text-texto-3">Enfrentamientos directos (3 últimas temporadas): </span>
          {h2h.length ? (
            <>
              {h2h.filter((x) => x.g).length}–{h2h.filter((x) => !x.g).length}
              <ul className="mt-1 space-y-0.5 text-texto-2">
                {h2h.slice(0, 5).map((x, i) => (
                  <li key={i}>
                    {fechaCorta(x.f)} · {x.t} ({x.r}, {NOMBRE_SUPERFICIE[x.s]}) · {x.g ? 'ganó' : 'perdió'} {x.m}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            'ninguno'
          )}
        </div>
      )}
    </div>
  );
}
