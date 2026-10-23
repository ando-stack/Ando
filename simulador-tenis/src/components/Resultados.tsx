import { useMemo, useState } from 'react';
import {
  filasHist,
  lineasHandicap,
  lineasOverUnder,
  mediaHist,
  totalHist,
  type EstadisticaJugador,
  type FilaFrecuencia,
  type Histograma,
  type LineaHandicap,
  type LineaOU,
  type ResultadosAgregados,
} from '../../engine/agregacion';
import { cuota, entero, linea, num, pct, signo } from '../lib/formato';
import { COLOR_A, COLOR_B, GraficoComparado, GraficoDistribucion, GraficoFrecuencias } from './Graficos';
import { Tabla, type Columna } from './Tabla';
import { Aviso, Pestanas, Tarjeta } from './ui';

type Seccion = 'resumen' | 'sets' | 'marcadores' | 'juegos' | 'porset' | 'tiebreaks' | 'saque' | 'otros';

interface Props {
  r: ResultadosAgregados;
  nombreA: string;
  nombreB: string;
}

/** Fila de frecuencia con probabilidad y (opcional) cuota justa. */
function columnasFrecuencia(n: number, titulo: string, cuotas: boolean): Columna<FilaFrecuencia>[] {
  const c: Columna<FilaFrecuencia>[] = [
    { id: 'k', titulo, valor: (f) => f.clave, alinear: 'izq' },
    { id: 'v', titulo: 'Veces', valor: (f) => f.veces, render: (f) => entero(f.veces) },
    { id: 'p', titulo: '%', valor: (f) => +(100 * (f.veces / n)).toFixed(2), render: (f) => pct(f.veces / n, 2) },
  ];
  if (cuotas) c.push({ id: 'c', titulo: 'Cuota justa', valor: (f) => cuota(f.veces / n) });
  return c;
}

interface FilaOU extends LineaOU {
  quien: string;
  idJ: string;
}

function columnasOU(cuotas: boolean, conJugador: boolean): Columna<FilaOU>[] {
  const t = (f: LineaOU) => f.over + f.under + f.push || 1;
  const c: Columna<FilaOU>[] = [];
  if (conJugador) c.push({ id: 'j', titulo: 'Jugador', valor: (f) => f.quien, alinear: 'izq' });
  c.push(
    { id: 'l', titulo: 'Línea', valor: (f) => linea(f.linea) },
    { id: 'o', titulo: 'Over', valor: (f) => f.over, render: (f) => entero(f.over) },
    { id: 'op', titulo: 'Over %', valor: (f) => +((100 * f.over) / t(f)).toFixed(2), render: (f) => pct(f.over / t(f)) },
    { id: 'u', titulo: 'Under', valor: (f) => f.under, render: (f) => entero(f.under) },
    { id: 'up', titulo: 'Under %', valor: (f) => +((100 * f.under) / t(f)).toFixed(2), render: (f) => pct(f.under / t(f)) },
    { id: 'pu', titulo: 'Nulo (= línea)', valor: (f) => f.push, render: (f) => (f.push ? entero(f.push) : '—') },
  );
  if (cuotas)
    c.push(
      { id: 'co', titulo: 'Cuota over', valor: (f) => cuota(f.over / (f.over + f.under || 1)) },
      { id: 'cu', titulo: 'Cuota under', valor: (f) => cuota(f.under / (f.over + f.under || 1)) },
    );
  return c;
}

const ordenOU = (filas: FilaOU[]) => [...filas].sort((a, b) => b.over / (b.over + b.under + b.push || 1) - a.over / (a.over + a.under + a.push || 1) || a.linea - b.linea);

function filasOU(h: Histograma, rango: number, quien: string, idJ: string): FilaOU[] {
  return lineasOverUnder(h, rango).map((l) => ({ ...l, quien, idJ }));
}

interface FilaHcp extends LineaHandicap {
  quien: string;
  idJ: string;
  /** Probabilidad de cubrir del jugador de la fila. */
  cubre: number;
  pierde: number;
}

function filasHandicap(dif: Histograma, rango: number, nombreA: string, nombreB: string): FilaHcp[] {
  const filas: FilaHcp[] = [];
  for (const l of lineasHandicap(dif, rango)) {
    filas.push({ ...l, quien: nombreA, idJ: 'a', cubre: l.ganaA, pierde: l.ganaB });
    // Para B, la línea es la opuesta.
    filas.push({ ...l, linea: -l.linea, quien: nombreB, idJ: 'b', cubre: l.ganaB, pierde: l.ganaA });
  }
  return filas.sort((x, y) => y.cubre - x.cubre || x.linea - y.linea);
}

function columnasHcp(cuotas: boolean): Columna<FilaHcp>[] {
  const t = (f: FilaHcp) => f.cubre + f.pierde + f.push || 1;
  const c: Columna<FilaHcp>[] = [
    { id: 'j', titulo: 'Jugador', valor: (f) => f.quien, alinear: 'izq' },
    { id: 'l', titulo: 'Hándicap', valor: (f) => signo(f.linea) },
    { id: 'c', titulo: 'Cubre', valor: (f) => f.cubre, render: (f) => entero(f.cubre) },
    { id: 'cp', titulo: 'Cubre %', valor: (f) => +((100 * f.cubre) / t(f)).toFixed(2), render: (f) => pct(f.cubre / t(f)) },
    { id: 'n', titulo: 'No cubre %', valor: (f) => +((100 * f.pierde) / t(f)).toFixed(2), render: (f) => pct(f.pierde / t(f)) },
    { id: 'p', titulo: 'Nulo', valor: (f) => f.push, render: (f) => (f.push ? entero(f.push) : '—') },
  ];
  if (cuotas) c.push({ id: 'q', titulo: 'Cuota justa', valor: (f) => cuota(f.cubre / (f.cubre + f.pierde || 1)) });
  return c;
}

/** Media de un porcentaje redondeado (histograma de 0..100). */
const mediaPct = (h: Histograma) => mediaHist(h) / 100;

export function PanelResultados({ r, nombreA, nombreB }: Props) {
  const [seccion, setSeccion] = useState<Seccion>('resumen');
  const [cuotas, setCuotas] = useState(false);
  const [rango, setRango] = useState(6);
  const [setSel, setSetSel] = useState(0);
  const n = r.n;
  const pA = r.victoriasA / n;
  const [jA, jB] = r.jugadores;
  const opcionesJ = [
    { id: 'a', texto: nombreA },
    { id: 'b', texto: nombreB },
  ];
  const filtroJ = { opciones: opcionesJ, aplica: (f: { idJ: string }, id: string) => f.idJ === id };

  // Resultado en sets desde la perspectiva A-B, con el nombre del ganador.
  const resSets = useMemo(
    () =>
      r.resultadoSets.map((f) => {
        const [a, b] = f.clave.split('-').map(Number);
        return { clave: `${f.clave} (${a > b ? nombreA : nombreB})`, veces: f.veces };
      }),
    [r, nombreA, nombreB],
  );

  const secciones: { id: Seccion; texto: string }[] = [
    { id: 'resumen', texto: 'Resumen' },
    { id: 'sets', texto: 'Resultado en sets' },
    { id: 'marcadores', texto: 'Marcadores exactos' },
    { id: 'juegos', texto: 'Juegos' },
    { id: 'porset', texto: 'Sets' },
    { id: 'tiebreaks', texto: 'Tie-breaks' },
    { id: 'saque', texto: 'Saque y resto' },
    { id: 'otros', texto: 'Otros' },
  ];

  const estadisticas: { id: keyof EstadisticaJugador; titulo: string; total?: Histograma; esPct?: boolean }[] = [
    { id: 'aces', titulo: 'Aces', total: r.totales.aces },
    { id: 'dobles', titulo: 'Dobles faltas', total: r.totales.dobles },
    { id: 'breaks', titulo: 'Breaks conseguidos', total: r.totales.breaks },
    { id: 'bpDisputados', titulo: 'Puntos de break disputados (al resto)', total: r.totales.bpDisputados },
    { id: 'juegosSaquePerdidos', titulo: 'Juegos al saque perdidos' },
    { id: 'pctPrimeros', titulo: '% primeros saques', esPct: true },
    { id: 'pctGanados1', titulo: '% puntos ganados con el 1.er saque', esPct: true },
    { id: 'pctGanados2', titulo: '% puntos ganados con el 2.º saque', esPct: true },
  ];
  const [statSel, setStatSel] = useState<keyof EstadisticaJugador>('aces');
  const st = estadisticas.find((e) => e.id === statSel)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-texto-2">
          <input type="checkbox" checked={cuotas} onChange={(e) => setCuotas(e.target.checked)} />
          Mostrar cuotas justas (1/probabilidad)
        </label>
        <label className="flex items-center gap-2 text-texto-2">
          Rango de líneas ±
          <input type="number" min={1} max={20} value={rango} onChange={(e) => setRango(Math.max(1, Math.min(20, Number(e.target.value) || 6)))} className="w-14 rounded border border-borde bg-fondo px-1 py-0.5 text-texto" />
        </label>
      </div>
      {cuotas && (
        <Aviso tipo="aviso">
          Las cuotas justas son el inverso de probabilidades simuladas, no predicciones seguras. Esto <strong>no es asesoramiento de apuestas</strong>. Juego
          responsable, sólo mayores de 18 años. Si el juego te genera problemas, pide ayuda (en España: jugarbien.es · 900 200 225).
        </Aviso>
      )}
      {r.incoherentes > 0 ? (
        <Aviso tipo="error">
          {r.incoherentes} simulaciones no superaron las comprobaciones de reglas ({r.primerErrorCoherencia}).
        </Aviso>
      ) : (
        <p className="text-xs text-ok">✔ Las {entero(n)} simulaciones superan las comprobaciones de coherencia (marcadores válidos, juegos = suma de sets, breaks = juegos al saque perdidos, ganador correcto).</p>
      )}
      <Pestanas valor={seccion} opciones={secciones} onChange={setSeccion} />

      {seccion === 'resumen' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo="Probabilidad de victoria">
            <div className="space-y-3">
              {[
                [nombreA, pA, COLOR_A],
                [nombreB, 1 - pA, COLOR_B],
              ].map(([nom, p, c]) => (
                <div key={nom as string}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{nom}</span>
                    <span className="num font-semibold">
                      {pct(p as number)} {cuotas && <span className="text-texto-3">· cuota {cuota(p as number)}</span>}
                    </span>
                  </div>
                  <div className="h-3 rounded bg-superficie-2">
                    <div className="h-3 rounded" style={{ width: `${100 * (p as number)}%`, background: c as string }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-texto-3">{entero(n)} simulaciones · victorias de {nombreA}: {entero(r.victoriasA)}</p>
            </div>
          </Tarjeta>
          <Tarjeta titulo="Medias por partido">
            <table className="num w-full text-sm">
              <thead>
                <tr className="text-xs text-texto-3">
                  <th className="text-left font-medium">Estadística</th>
                  <th className="text-right font-medium" style={{ color: COLOR_A }}>{nombreA}</th>
                  <th className="text-right font-medium" style={{ color: COLOR_B }}>{nombreB}</th>
                  <th className="text-right font-medium">Partido</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Juegos', mediaHist(jA.juegos), mediaHist(jB.juegos), mediaHist(r.juegosTotales)],
                    ['Sets', mediaHist(jA.setsGanados), mediaHist(jB.setsGanados), mediaHist(r.numSets)],
                    ['Tie-breaks ganados', mediaHist(jA.tiebreaksGanados), mediaHist(jB.tiebreaksGanados), mediaHist(r.tiebreaks)],
                    ['Aces', mediaHist(jA.aces), mediaHist(jB.aces), mediaHist(r.totales.aces)],
                    ['Dobles faltas', mediaHist(jA.dobles), mediaHist(jB.dobles), mediaHist(r.totales.dobles)],
                    ['Breaks', mediaHist(jA.breaks), mediaHist(jB.breaks), mediaHist(r.totales.breaks)],
                    ['Puntos de break disputados', mediaHist(jA.bpDisputados), mediaHist(jB.bpDisputados), mediaHist(r.totales.bpDisputados)],
                    ['Juegos al saque perdidos', mediaHist(jA.juegosSaquePerdidos), mediaHist(jB.juegosSaquePerdidos), null],
                    ['% primeros', mediaPct(jA.pctPrimeros), mediaPct(jB.pctPrimeros), null, true],
                    ['% ganados con el 1.º', mediaPct(jA.pctGanados1), mediaPct(jB.pctGanados1), null, true],
                    ['% ganados con el 2.º', mediaPct(jA.pctGanados2), mediaPct(jB.pctGanados2), null, true],
                  ] as [string, number, number, number | null, boolean?][]
                ).map(([t, a, b, tot, esPct]) => (
                  <tr key={t} className="border-t border-borde/40">
                    <td className="py-1 text-texto-2">{t}</td>
                    <td className="text-right">{esPct ? pct(a) : num(a)}</td>
                    <td className="text-right">{esPct ? pct(b) : num(b)}</td>
                    <td className="text-right">{tot === null ? '—' : num(tot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tarjeta>
        </div>
      )}

      {seccion === 'sets' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo={`Resultado en sets (${nombreA} – ${nombreB})`}>
            <GraficoFrecuencias filas={resSets} n={n} />
          </Tarjeta>
          <Tarjeta>
            <Tabla titulo="Resultado en sets" filas={resSets} columnas={columnasFrecuencia(n, 'Resultado', cuotas)} archivo="resultado-sets" />
          </Tarjeta>
        </div>
      )}

      {seccion === 'marcadores' && (
        <Tarjeta titulo={`Marcadores exactos (juegos de ${nombreA} primero)`}>
          <p className="mb-2 text-xs text-texto-3">{entero(r.marcadores.length)} marcadores distintos. Puedes buscar, por ejemplo, «7-6» o «6-0».</p>
          <Tabla filas={r.marcadores} columnas={columnasFrecuencia(n, 'Marcador', cuotas)} archivo="marcadores-exactos" maxFilas={25} />
        </Tarjeta>
      )}

      {seccion === 'juegos' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo={`Total de juegos del partido · media ${num(mediaHist(r.juegosTotales))}`}>
            <GraficoDistribucion h={r.juegosTotales} etiqueta="Juegos" />
            <Tabla titulo="Distribución completa" filas={filasHist(r.juegosTotales, ' juegos')} columnas={columnasFrecuencia(n, 'Juegos', cuotas)} archivo="total-juegos" />
          </Tarjeta>
          <Tarjeta titulo="Over/under del total de juegos">
            <Tabla filas={ordenOU(filasOU(r.juegosTotales, rango, 'Partido', 'p'))} columnas={columnasOU(cuotas, false)} archivo="over-under-juegos" maxFilas={30} />
          </Tarjeta>
          <Tarjeta titulo="Juegos ganados por cada jugador">
            <GraficoComparado ha={jA.juegos} hb={jB.juegos} nombreA={nombreA} nombreB={nombreB} etiqueta="Juegos ganados" />
            <Tabla
              titulo="Over/under de juegos por jugador"
              filas={ordenOU([...filasOU(jA.juegos, rango, nombreA, 'a'), ...filasOU(jB.juegos, rango, nombreB, 'b')])}
              columnas={columnasOU(cuotas, true)}
              archivo="over-under-juegos-jugador"
              filtroJugador={filtroJ}
              maxFilas={20}
            />
          </Tarjeta>
          <Tarjeta titulo="Hándicap de juegos">
            <GraficoDistribucion h={r.diferenciaJuegos} etiqueta={`Diferencia de juegos (${nombreA} − ${nombreB})`} />
            <Tabla filas={filasHandicap(r.diferenciaJuegos, rango, nombreA, nombreB)} columnas={columnasHcp(cuotas)} archivo="handicap-juegos" filtroJugador={filtroJ} maxFilas={20} />
          </Tarjeta>
        </div>
      )}

      {seccion === 'porset' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo="Número de sets jugados">
            <Tabla filas={filasHist(r.numSets, ' sets')} columnas={columnasFrecuencia(n, 'Sets', cuotas)} archivo="numero-sets" />
            <div className="mt-3">
              <Tabla
                titulo="Hándicap de sets"
                filas={filasHandicap(r.diferenciaSets, r.mejorDe === 5 ? 3 : 2, nombreA, nombreB).filter((f) => !Number.isInteger(f.linea))}
                columnas={columnasHcp(cuotas)}
                archivo="handicap-sets"
                filtroJugador={filtroJ}
              />
            </div>
          </Tarjeta>
          <Tarjeta titulo="Al menos un set">
            <Tabla
              filas={[
                { clave: `${nombreA} gana al menos un set`, veces: jA.alMenosUnSet },
                { clave: `${nombreB} gana al menos un set`, veces: jB.alMenosUnSet },
              ].sort((a, b) => b.veces - a.veces)}
              columnas={columnasFrecuencia(n, 'Mercado', cuotas)}
              archivo="al-menos-un-set"
            />
          </Tarjeta>
          <Tarjeta
            titulo="Mercados de cada set"
            className="lg:col-span-2"
            extra={
              <select value={setSel} onChange={(e) => setSetSel(Number(e.target.value))} className="rounded-md border border-borde bg-fondo px-2 py-1 text-sm" aria-label="Elegir set">
                {r.porSet.map((p, i) => (
                  <option key={i} value={i} disabled={!p.jugado}>
                    {i + 1}.º set{i === 0 ? ' (primer set)' : ''} {p.jugado < n ? `· se juega en ${pct(p.jugado / n)}` : ''}
                  </option>
                ))}
              </select>
            }
          >
            {(() => {
              const p = r.porSet[setSel];
              if (!p.jugado) return <p className="text-sm text-texto-3">Este set no se ha jugado en ninguna simulación.</p>;
              const ganador = [
                { clave: nombreA, veces: p.ganaA },
                { clave: nombreB, veces: p.jugado - p.ganaA },
              ].sort((a, b) => b.veces - a.veces);
              return (
                <div className="grid gap-4 md:grid-cols-3">
                  <Tabla titulo={`Ganador del ${setSel + 1}.º set`} filas={ganador} columnas={columnasFrecuencia(p.jugado, 'Jugador', cuotas)} archivo={`ganador-set-${setSel + 1}`} />
                  <Tabla titulo={`Marcador exacto del ${setSel + 1}.º set`} filas={p.marcadores} columnas={columnasFrecuencia(p.jugado, 'Marcador', cuotas)} archivo={`marcador-set-${setSel + 1}`} />
                  <Tabla
                    titulo={`Over/under de juegos del ${setSel + 1}.º set`}
                    filas={ordenOU(filasOU(p.juegos, Math.min(rango, 5), 'Set', 'p'))}
                    columnas={columnasOU(cuotas, false)}
                    archivo={`over-under-set-${setSel + 1}`}
                  />
                  <p className="text-xs text-texto-3 md:col-span-3">Porcentajes sobre las {entero(p.jugado)} simulaciones en las que se jugó este set.</p>
                </div>
              );
            })()}
          </Tarjeta>
        </div>
      )}

      {seccion === 'tiebreaks' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo={`Al menos un tie-break: ${pct(r.alMenosUnTiebreak / n)}`}>
            <Tabla
              titulo="Número de tie-breaks"
              filas={[
                { clave: 'Al menos un tie-break', veces: r.alMenosUnTiebreak },
                { clave: 'Ningún tie-break', veces: n - r.alMenosUnTiebreak },
                ...filasHist(r.tiebreaks, ' tie-breaks'),
              ].sort((a, b) => b.veces - a.veces)}
              columnas={columnasFrecuencia(n, 'Tie-breaks', cuotas)}
              archivo="tiebreaks"
            />
          </Tarjeta>
          <Tarjeta titulo="Tie-break en cada set y quién lo gana">
            <Tabla
              filas={r.porSet
                .flatMap((p, i) => [
                  { clave: `${i + 1}.º set: hay tie-break`, veces: p.tiebreak },
                  { clave: `${i + 1}.º set: tie-break para ${nombreA}`, veces: p.tiebreakGanaA },
                  { clave: `${i + 1}.º set: tie-break para ${nombreB}`, veces: p.tiebreak - p.tiebreakGanaA },
                ])
                .filter((f) => f.veces > 0)
                .sort((a, b) => b.veces - a.veces)}
              columnas={columnasFrecuencia(n, 'Mercado', cuotas)}
              archivo="tiebreak-por-set"
            />
            <p className="mt-2 text-xs text-texto-3">Porcentajes sobre el total de simulaciones (incluidas las que no llegan a ese set).</p>
          </Tarjeta>
          <Tarjeta titulo="Tie-breaks ganados por jugador" className="lg:col-span-2">
            <GraficoComparado ha={jA.tiebreaksGanados} hb={jB.tiebreaksGanados} nombreA={nombreA} nombreB={nombreB} etiqueta="Tie-breaks ganados" alto={160} />
          </Tarjeta>
        </div>
      )}

      {seccion === 'saque' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1">
            {estadisticas.map((e) => (
              <button
                key={e.id}
                onClick={() => setStatSel(e.id)}
                className={`rounded-full border px-3 py-1 text-xs ${statSel === e.id ? 'border-acento text-texto' : 'border-borde text-texto-2'}`}
              >
                {e.titulo}
              </button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta
              titulo={`${st.titulo} · media ${nombreA} ${st.esPct ? pct(mediaPct(jA[st.id] as Histograma)) : num(mediaHist(jA[st.id] as Histograma))} · ${nombreB} ${st.esPct ? pct(mediaPct(jB[st.id] as Histograma)) : num(mediaHist(jB[st.id] as Histograma))}${st.total ? ` · partido ${num(mediaHist(st.total))}` : ''}`}
            >
              <GraficoComparado ha={jA[st.id] as Histograma} hb={jB[st.id] as Histograma} nombreA={nombreA} nombreB={nombreB} etiqueta={st.titulo} />
              {st.total && (
                <div className="mt-3">
                  <h3 className="mb-1 text-sm font-semibold">Total del partido</h3>
                  <GraficoDistribucion h={st.total} etiqueta={`${st.titulo} (partido)`} alto={150} />
                </div>
              )}
            </Tarjeta>
            <Tarjeta titulo="Over/under">
              <Tabla
                filas={ordenOU([
                  ...filasOU(jA[st.id] as Histograma, rango, nombreA, 'a'),
                  ...filasOU(jB[st.id] as Histograma, rango, nombreB, 'b'),
                  ...(st.total ? filasOU(st.total, rango, 'Partido', 'p') : []),
                ])}
                columnas={columnasOU(cuotas, true)}
                archivo={`over-under-${st.id}`}
                filtroJugador={filtroJ}
                maxFilas={20}
              />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Tabla titulo={`Distribución · ${nombreA}`} filas={filasHist(jA[st.id] as Histograma, st.esPct ? ' %' : '')} columnas={columnasFrecuencia(n, 'Valor', cuotas)} archivo={`${st.id}-a`} maxFilas={8} />
                <Tabla titulo={`Distribución · ${nombreB}`} filas={filasHist(jB[st.id] as Histograma, st.esPct ? ' %' : '')} columnas={columnasFrecuencia(n, 'Valor', cuotas)} archivo={`${st.id}-b`} maxFilas={8} />
              </div>
            </Tarjeta>
          </div>
        </div>
      )}

      {seccion === 'otros' && (
        <Tarjeta titulo="Otros mercados">
          <Tabla
            filas={[
              { clave: 'Algún set en blanco (6-0)', veces: r.setEnBlanco },
              { clave: `${nombreA} gana algún set 6-0`, veces: jA.setEnBlanco },
              { clave: `${nombreB} gana algún set 6-0`, veces: jB.setEnBlanco },
              { clave: `${nombreA} remonta tras perder el primer set`, veces: jA.remontadas },
              { clave: `${nombreB} remonta tras perder el primer set`, veces: jB.remontadas },
              { clave: 'Hay remontada (cualquiera)', veces: jA.remontadas + jB.remontadas },
              { clave: `${nombreA} gana sin perder su saque`, veces: jA.sinPerderSaque },
              { clave: `${nombreB} gana sin perder su saque`, veces: jB.sinPerderSaque },
              { clave: 'El ganador no pierde su saque', veces: jA.sinPerderSaque + jB.sinPerderSaque },
            ].sort((a, b) => b.veces - a.veces)}
            columnas={columnasFrecuencia(n, 'Mercado', cuotas)}
            archivo="otros-mercados"
          />
          <p className="mt-2 text-xs text-texto-3">
            P(remontada | pierde el primer set): {nombreA} {pct(jA.remontadas / Math.max(1, n - r.porSet[0].ganaA))} · {nombreB}{' '}
            {pct(jB.remontadas / Math.max(1, r.porSet[0].ganaA))}
          </p>
        </Tarjeta>
      )}
      <p className="text-xs text-texto-3">Total de simulaciones contadas: {entero(totalHist(r.juegosTotales))}.</p>
    </div>
  );
}
