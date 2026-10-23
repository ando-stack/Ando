import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FORMATOS, NOMBRE_CIRCUITO, NOMBRE_SUPERFICIE, SUPERFICIES, type Circuito, type Superficie } from '../../config/formatos';
import type { ResultadosAgregados } from '../../engine/agregacion';
import { parametrosPartido, type DetalleModelo, type ParamsModelo } from '../../engine/modelo';
import { FichaPrevia } from '../components/FichaPrevia';
import { COLOR_A, COLOR_B } from '../components/Graficos';
import { PanelResultados } from '../components/Resultados';
import { SelectorJugador } from '../components/SelectorJugador';
import { Aviso, Boton, Cargando, Tarjeta } from '../components/ui';
import { cargarFicha, cargarIndice, cargarModelo } from '../lib/datos';
import { entero, pct } from '../lib/formato';
import { guardar, guardarUltima, type SimulacionGuardada } from '../lib/guardadas';
import { simularEnParalelo } from '../lib/simular';
import type { EntradaIndice, FichaJugador } from '../lib/tiposDatos';

const CIRCUITOS: Circuito[] = ['ATP', 'WTA', 'CH', 'W125'];

export default function Simulador() {
  const [sp, setSp] = useSearchParams();
  const navegar = useNavigate();
  const [indice, setIndice] = useState<EntradaIndice[] | null>(null);
  const [M, setM] = useState<ParamsModelo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<EntradaIndice | null>(null);
  const [b, setB] = useState<EntradaIndice | null>(null);
  const [fa, setFa] = useState<FichaJugador | null>(null);
  const [fb, setFb] = useState<FichaJugador | null>(null);
  const [sup, setSup] = useState<Superficie>((sp.get('sup') as Superficie) || 'dura');
  const [cub, setCub] = useState<string>(sp.get('cub') ?? '');
  const [formatoId, setFormatoId] = useState(sp.get('formato') || 'BO3_TB7');
  const [circuito, setCircuito] = useState<Circuito>((sp.get('circuito') as Circuito) || 'ATP');
  const [n, setN] = useState(5000);
  const [semilla, setSemilla] = useState(() => Math.floor(Math.random() * 1e9));
  const [progreso, setProgreso] = useState<number | null>(null);
  const [tiempo, setTiempo] = useState<number | null>(null);
  const [res, setRes] = useState<{ r: ResultadosAgregados; d: DetalleModelo; id: string } | null>(null);
  const [guardado, setGuardado] = useState(false);
  const cancelar = useRef<(() => void) | null>(null);
  const torneo = sp.get('torneo') ?? undefined;

  useEffect(() => {
    Promise.all([cargarIndice(), cargarModelo()])
      .then(([i, m]) => {
        setIndice(i);
        setM(m);
        const ia = sp.get('a');
        const ib = sp.get('b');
        if (ia) setA(i.find((x) => x.id === ia) ?? null);
        if (ib) setB(i.find((x) => x.id === ib) ?? null);
      })
      .catch((e: Error) => setError(e.message));
    return () => cancelar.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setFa(null);
    if (a) cargarFicha(a.id).then(setFa);
  }, [a]);
  useEffect(() => {
    setFb(null);
    if (b) cargarFicha(b.id).then(setFb);
  }, [b]);

  // En modo libre, el circuito por defecto es el del jugador A.
  useEffect(() => {
    if (!sp.get('circuito') && a && CIRCUITOS.includes(a.circuito as Circuito)) setCircuito(a.circuito as Circuito);
  }, [a, sp]);

  const mismoPool = !a || !b || a.pool === b.pool;
  const formato = FORMATOS[formatoId] ?? FORMATOS.BO3_TB7;
  const preparado = useMemo(() => {
    if (!fa || !fb || !M || !mismoPool) return null;
    return parametrosPartido(fa.perfil, fb.perfil, { superficie: sup, circuito, formato, cubierta: cub === '' ? undefined : cub === '1' }, M);
  }, [fa, fb, M, sup, circuito, formato, cub, mismoPool]);

  const simular = () => {
    if (!preparado || !a || !b) return;
    setRes(null);
    setGuardado(false);
    setProgreso(0);
    const t0 = performance.now();
    const job = simularEnParalelo(preparado.params, formato, n, semilla, setProgreso);
    cancelar.current = job.cancelar;
    job.promesa
      .then((r) => {
        const ms = performance.now() - t0;
        setTiempo(ms);
        const id = `${Date.now().toString(36)}-${semilla.toString(36)}`;
        setRes({ r, d: preparado.detalle, id });
        guardarUltima(construir(id, r, preparado.detalle, ms));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setProgreso(null));
  };

  const construir = (id: string, r: ResultadosAgregados, d: DetalleModelo, ms: number): SimulacionGuardada => ({
    id,
    fecha: new Date().toISOString(),
    titulo: `${a!.nombre} vs ${b!.nombre}${torneo ? ` · ${torneo}` : ''}`,
    a: { id: a!.id, nombre: a!.nombre },
    b: { id: b!.id, nombre: b!.nombre },
    contexto: { superficie: sup, cubierta: cub === '' ? null : cub === '1', formatoId, circuito, torneo },
    n,
    semilla,
    tiempoMs: ms,
    detalle: {
      pElo: d.pElo,
      pEstadisticas: d.pEstadisticas,
      pFormato: d.pFormato,
      pSaqueA: d.pSaqueA,
      pSaqueB: d.pSaqueB,
      estimadoA: d.estA.estimado,
      estimadoB: d.estB.estimado,
      nRealA: d.estA.nReal,
      nRealB: d.estB.nReal,
    },
    resultados: r,
  });

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!indice || !M) return <Cargando texto="Cargando jugadores y modelo…" />;

  const actualizarUrl = (k: string, v: string) => {
    const q = new URLSearchParams(sp);
    q.set(k, v);
    setSp(q, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Simulador</h1>
        {torneo ? <p className="text-sm text-texto-2">Partido de {torneo}</p> : <p className="text-sm text-texto-2">Modo libre: elige dos jugadores (del mismo circuito masculino o femenino), la superficie y el formato.</p>}
      </div>
      <Tarjeta>
        <div className="grid gap-3 md:grid-cols-2">
          <SelectorJugador indice={indice} valor={a} onChange={(j) => { setA(j); actualizarUrl('a', j.id); }} etiqueta="Jugador A" pool={b?.pool} color={COLOR_A} />
          <SelectorJugador indice={indice} valor={b} onChange={(j) => { setB(j); actualizarUrl('b', j.id); }} etiqueta="Jugador B" pool={a?.pool} color={COLOR_B} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
          <label className="text-xs text-texto-3">
            Superficie
            <select value={sup} onChange={(e) => setSup(e.target.value as Superficie)} className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto">
              {SUPERFICIES.map((s) => (
                <option key={s} value={s}>
                  {NOMBRE_SUPERFICIE[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-texto-3">
            Pista
            <select value={cub} onChange={(e) => setCub(e.target.value)} className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto">
              <option value="">No indicada</option>
              <option value="0">Exterior</option>
              <option value="1">Cubierta</option>
            </select>
          </label>
          <label className="col-span-2 text-xs text-texto-3">
            Formato
            <select value={formatoId} onChange={(e) => setFormatoId(e.target.value)} className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto">
              {Object.values(FORMATOS).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-texto-3">
            Circuito (calibración)
            <select value={circuito} onChange={(e) => setCircuito(e.target.value as Circuito)} className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto">
              {CIRCUITOS.map((c) => (
                <option key={c} value={c}>
                  {NOMBRE_CIRCUITO[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-texto-3">
            Simulaciones
            <input
              type="number"
              min={1000}
              max={100000}
              step={1000}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              onBlur={() => setN((x) => Math.max(1000, Math.min(100000, Math.round(x || 5000))))}
              className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Boton tipo="primario" onClick={simular} disabled={!preparado || progreso !== null || n < 1000 || n > 100000}>
            Simular
          </Boton>
          <label className="flex items-center gap-1 text-xs text-texto-3">
            Semilla
            <input type="number" value={semilla} onChange={(e) => setSemilla(Number(e.target.value) || 0)} className="w-28 rounded border border-borde bg-fondo px-1 py-0.5 text-texto" />
          </label>
          <button className="text-xs text-texto-2 hover:text-texto" onClick={() => setSemilla(Math.floor(Math.random() * 1e9))}>
            Nueva semilla
          </button>
          {progreso !== null && (
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <div className="h-2 flex-1 rounded bg-superficie-2" role="progressbar" aria-valuenow={Math.round(progreso * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-2 rounded bg-acento transition-all" style={{ width: `${progreso * 100}%` }} />
              </div>
              <span className="num text-xs text-texto-2">{Math.round(progreso * 100)} %</span>
              <button className="text-xs text-error" onClick={() => { cancelar.current?.(); setProgreso(null); }}>
                Cancelar
              </button>
            </div>
          )}
          {tiempo !== null && progreso === null && res && (
            <span className="text-xs text-texto-2">
              {entero(res.r.n)} simulaciones en {(tiempo / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} s
            </span>
          )}
        </div>
        {(n < 1000 || n > 100000) && <p className="mt-1 text-xs text-error">El número de simulaciones debe estar entre 1.000 y 100.000.</p>}
        {!mismoPool && <Aviso tipo="error">No se pueden enfrentar jugadores de circuitos masculino y femenino.</Aviso>}
      </Tarjeta>

      {(fa || fb) && M && (
        <div className="grid gap-3 md:grid-cols-2">
          {fa && <FichaPrevia f={fa} sup={sup} M={M} rival={b?.id} color={COLOR_A} />}
          {fb && <FichaPrevia f={fb} sup={sup} M={M} rival={a?.id} color={COLOR_B} />}
        </div>
      )}
      {preparado && (
        <Tarjeta titulo="Cómo ve el modelo este partido">
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div>
              <div className="text-xs text-texto-3">Elo de superficie + forma (mejor de 3)</div>
              <div className="num">{a?.nombre}: {pct(preparado.detalle.pElo)}</div>
            </div>
            <div>
              <div className="text-xs text-texto-3">Estadísticas de saque y resto (mejor de 3)</div>
              <div className="num">{a?.nombre}: {pct(preparado.detalle.pEstadisticas)}</div>
            </div>
            <div>
              <div className="text-xs text-texto-3">Combinado, en este formato (exacto)</div>
              <div className="num font-semibold">{a?.nombre}: {pct(preparado.detalle.pFormato)}</div>
            </div>
            <div>
              <div className="text-xs text-texto-3">P(ganar un punto al saque)</div>
              <div className="num">
                {pct(preparado.detalle.pSaqueA)} · {pct(preparado.detalle.pSaqueB)}
              </div>
            </div>
          </div>
          {(preparado.detalle.estA.estimado || preparado.detalle.estB.estimado) && (
            <div className="mt-2">
              <Aviso tipo="aviso">
                {[preparado.detalle.estA.estimado && `${a?.nombre} (${preparado.detalle.estA.nReal} partidos con estadísticas)`, preparado.detalle.estB.estimado && `${b?.nombre} (${preparado.detalle.estB.nReal} partidos con estadísticas)`]
                  .filter(Boolean)
                  .join(' y ')}{' '}
                tiene{preparado.detalle.estA.estimado && preparado.detalle.estB.estimado ? 'n' : ''} pocos datos: sus estadísticas son <strong>estimadas</strong> a partir de su Elo, la superficie y la media del circuito.
              </Aviso>
            </div>
          )}
        </Tarjeta>
      )}

      {res && a && b && (
        <Tarjeta
          titulo={`Resultados: ${a.nombre} vs ${b.nombre}`}
          extra={
            <div className="flex gap-2">
              <Boton
                onClick={() => {
                  setGuardado(guardar(construir(res.id, res.r, res.d, tiempo ?? 0)));
                }}
                disabled={guardado}
              >
                {guardado ? 'Guardada ✔' : 'Guardar simulación'}
              </Boton>
              <Boton onClick={() => navegar('/historial')}>Comparar</Boton>
            </div>
          }
        >
          <PanelResultados r={res.r} nombreA={a.nombre} nombreB={b.nombre} />
        </Tarjeta>
      )}
    </div>
  );
}
