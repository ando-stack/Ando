import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NOMBRE_CIRCUITO, NOMBRE_SUPERFICIE, SUPERFICIES, type Circuito, type Superficie } from '../../config/formatos';
import type { ParamsModelo } from '../../engine/modelo';
import { estadisticasLegibles, FichaPrevia } from '../components/FichaPrevia';
import { COLOR_A, GraficoEvolucion } from '../components/Graficos';
import { SelectorJugador } from '../components/SelectorJugador';
import { Aviso, Bandera, Cargando, EtiquetaEstimado, Tarjeta } from '../components/ui';
import { cargarFicha, cargarIndice, cargarModelo } from '../lib/datos';
import { edad, fechaCorta, pct } from '../lib/formato';
import type { EntradaIndice, FichaJugador } from '../lib/tiposDatos';

export default function Jugador() {
  const { id = '' } = useParams();
  const [f, setF] = useState<FichaJugador | null | undefined>(undefined);
  const [M, setM] = useState<ParamsModelo | null>(null);
  const [indice, setIndice] = useState<EntradaIndice[]>([]);
  const [rival, setRival] = useState<EntradaIndice | null>(null);
  const [sup, setSup] = useState<Superficie>('dura');

  useEffect(() => {
    setF(undefined);
    cargarFicha(id).then(setF).catch(() => setF(null));
    cargarModelo().then(setM);
    cargarIndice().then(setIndice).catch(() => undefined);
  }, [id]);

  const h2h = useMemo(() => (f && rival ? f.partidos.filter((x) => x.o === rival.id) : []), [f, rival]);

  if (f === undefined || !M) return <Cargando />;
  if (f === null) return <Aviso tipo="error">Jugador no encontrado.</Aviso>;
  const j = f.perfil;
  const ed = edad(j.nacimiento);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <Bandera pais={j.pais} /> {j.nombre}
        </h1>
        <p className="text-sm text-texto-2">
          {NOMBRE_CIRCUITO[j.circuito as Circuito] ?? j.circuito} · {j.ranking ? `ranking #${j.ranking.pos} (${j.ranking.fuente}, ${fechaCorta(j.ranking.fecha)})` : 'sin ranking'} ·{' '}
          {ed !== null ? `${ed} años` : 'edad no disponible'} · mano {j.mano === 'L' ? 'zurda' : j.mano === 'R' ? 'diestra' : 'no disponible'} · revés: no disponible en las fuentes
        </p>
        <div className="mt-1">
          <EtiquetaEstimado n={j.nReal.todas} minimo={M.minPartidosReales} />
          <span className="ml-2 text-xs text-texto-3">
            {j.nPartidos} partidos en el histórico usado · último: {fechaCorta(j.ultimoPartido)}
          </span>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Elo">
          <table className="num w-full text-sm">
            <tbody>
              <tr>
                <td className="text-texto-2">General</td>
                <td className="text-right font-semibold">{j.elo.g}</td>
                <td className="text-right text-xs text-texto-3">{j.elo.n} partidos</td>
              </tr>
              {SUPERFICIES.map((s) => (
                <tr key={s} className="border-t border-borde/40">
                  <td className="text-texto-2">{NOMBRE_SUPERFICIE[s]}</td>
                  <td className="text-right">{j.elo.s[s]}</td>
                  <td className="text-right text-xs text-texto-3">{j.elo.ns[s]} partidos</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(j as { eloEstimado?: boolean }).eloEstimado && <p className="mt-2 text-xs text-aviso">Elo estimado a partir del ranking (menos de 5 partidos en el histórico).</p>}
          {f.eloHistorico.length > 1 && <GraficoEvolucion puntos={f.eloHistorico} etiqueta="Elo general" />}
        </Tarjeta>
        <Tarjeta titulo="Ranking">
          {f.rankings.length > 1 ? <GraficoEvolucion puntos={f.rankings} etiqueta="Ranking" invertido /> : <p className="text-sm text-texto-3">Sin evolución de ranking disponible.</p>}
        </Tarjeta>
        <Tarjeta titulo="Saque y resto por superficie">
          <table className="num w-full text-xs">
            <thead>
              <tr className="text-texto-3">
                <th className="text-left font-medium" />
                {(['todas', ...SUPERFICIES] as const).map((s) => (
                  <th key={s} className="text-right font-medium">
                    {s === 'todas' ? 'Todas' : NOMBRE_SUPERFICIE[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Partidos con datos', null],
                  ['Pts. ganados al saque', 'saque'],
                  ['% primeros', 'primeros'],
                  ['Ganados con el 1.º', 'ganados1'],
                  ['Ganados con el 2.º', 'ganados2'],
                  ['Aces / punto', 'aces'],
                  ['Dobles faltas / punto', 'dobles'],
                  ['BP salvados', 'bpSalvados'],
                  ['Juegos al saque ganados', 'juegosSaque'],
                  ['Pts. ganados al resto', 'resto'],
                  ['Juegos al resto ganados', 'breaks'],
                  ['Tie-breaks ganados', 'tiebreaks'],
                ] as [string, keyof ReturnType<typeof estadisticasLegibles> | null][]
              ).map(([t, k]) => (
                <tr key={t} className="border-t border-borde/40">
                  <td className="py-0.5 text-texto-2">{t}</td>
                  {(['todas', ...SUPERFICIES] as const).map((s) => {
                    const v = k ? estadisticasLegibles(j.stats[s])[k] : j.nReal[s];
                    return (
                      <td key={s} className="text-right">
                        {k ? (Number.isFinite(v) ? pct(v) : '—') : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-texto-3">Medias ponderadas de 2023 en adelante (vida media de {M.vidaMediaDias} días).</p>
        </Tarjeta>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Ficha previa por superficie"
          extra={
            <select value={sup} onChange={(e) => setSup(e.target.value as Superficie)} className="rounded-md border border-borde bg-fondo px-2 py-1 text-sm" aria-label="Superficie">
              {SUPERFICIES.map((s) => (
                <option key={s} value={s}>
                  {NOMBRE_SUPERFICIE[s]}
                </option>
              ))}
            </select>
          }
        >
          <FichaPrevia f={f} sup={sup} M={M} rival={rival?.id} color={COLOR_A} />
        </Tarjeta>
        <Tarjeta titulo="Enfrentamientos directos">
          <SelectorJugador indice={indice.filter((x) => x.id !== j.id)} valor={rival} onChange={setRival} etiqueta="Rival" pool={j.pool} color="#c3c2b7" />
          {rival && (
            <div className="mt-2 text-sm">
              <p>
                {j.nombre} {h2h.filter((x) => x.g).length} – {h2h.filter((x) => !x.g).length} {rival.nombre} (3 últimas temporadas)
              </p>
              <ul className="mt-1 space-y-1 text-xs text-texto-2">
                {h2h.map((x, i) => (
                  <li key={i}>
                    {fechaCorta(x.f)} · {x.t} · {x.r} · {NOMBRE_SUPERFICIE[x.s]} · {x.g ? 'ganó' : 'perdió'} {x.m}
                  </li>
                ))}
              </ul>
              <Link to={`/simulador?a=${j.id}&b=${rival.id}&sup=${sup}`} className="mt-2 inline-block rounded-lg bg-acento px-3 py-1 text-xs font-semibold text-[#1a1a19]">
                Simular {j.nombre} vs {rival.nombre}
              </Link>
            </div>
          )}
        </Tarjeta>
      </div>
      <Tarjeta titulo={`Últimos partidos (${f.partidos.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-texto-3">
                <th className="text-left font-medium">Fecha</th>
                <th className="text-left font-medium">Torneo</th>
                <th className="text-left font-medium">Ronda</th>
                <th className="text-left font-medium">Superficie</th>
                <th className="text-left font-medium">Rival</th>
                <th className="text-left font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {f.partidos.slice(0, 40).map((x, i) => (
                <tr key={i} className="border-t border-borde/40">
                  <td className="py-0.5">{fechaCorta(x.f)}</td>
                  <td>{x.t}</td>
                  <td>{x.r}</td>
                  <td>{NOMBRE_SUPERFICIE[x.s]}</td>
                  <td>
                    <Link to={`/jugador/${x.o}`} className="hover:underline">
                      {x.on}
                    </Link>
                  </td>
                  <td className={x.g ? 'text-ok' : 'text-error'}>
                    {x.g ? 'V' : 'D'} {x.m}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}
