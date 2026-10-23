import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NOMBRE_CIRCUITO, SUPERFICIES, NOMBRE_SUPERFICIE, type Circuito } from '../../config/formatos';
import { Aviso, Cargando, EtiquetaCircuito, EtiquetaSuperficie, Tarjeta } from '../components/ui';
import { cargarMeta, cargarTorneos } from '../lib/datos';
import { fechaCorta, fechaHora } from '../lib/formato';
import type { MetaDatos, TorneoVivo } from '../lib/tiposDatos';

const CIRCUITOS: Circuito[] = ['ATP', 'WTA', 'CH', 'W125'];

export default function Torneos() {
  const [torneos, setTorneos] = useState<TorneoVivo[] | null>(null);
  const [origen, setOrigen] = useState('');
  const [meta, setMeta] = useState<MetaDatos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [circuitos, setCircuitos] = useState<Set<Circuito>>(new Set(CIRCUITOS));
  const [sup, setSup] = useState<string>('todas');
  const [estado, setEstado] = useState<string>('todos');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  useEffect(() => {
    cargarTorneos()
      .then((r) => {
        setTorneos(r.torneos);
        setOrigen(r.origen);
      })
      .catch((e: Error) => setError(e.message));
    cargarMeta().then(setMeta).catch(() => undefined);
  }, []);

  const filtrados = useMemo(
    () =>
      (torneos ?? []).filter(
        (t) =>
          t.estado !== 'terminado' &&
          circuitos.has(t.circuito) &&
          (sup === 'todas' || t.superficie === sup) &&
          (estado === 'todos' || t.estado === estado) &&
          (!desde || t.fin >= desde) &&
          (!hasta || t.inicio <= hasta),
      ),
    [torneos, circuitos, sup, estado, desde, hasta],
  );

  const toggle = (c: Circuito) => {
    const s = new Set(circuitos);
    if (s.has(c)) s.delete(c);
    else s.add(c);
    setCircuitos(s);
  };

  const fuentesConError = meta?.fuentes.filter((f) => !f.ok) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Torneos en curso y próximos</h1>
        <p className="text-sm text-texto-2">Elige un torneo para ver su cuadro y el orden de juego, o ve al <Link to="/simulador" className="text-acento hover:underline">modo libre</Link> para enfrentar a dos jugadores cualesquiera.</p>
      </div>
      {fuentesConError.map((f) => (
        <Aviso key={f.fuente} tipo="aviso">
          La fuente <strong>{f.fuente}</strong> falló en la última actualización ({f.error}). Se muestran sus últimos datos válidos
          {f.ultimoExito ? ` (${fechaHora(f.ultimoExito)})` : ''}.
        </Aviso>
      ))}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-borde bg-superficie p-3 text-sm">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="mb-1 text-xs text-texto-3">Circuito</legend>
          {CIRCUITOS.map((c) => (
            <label key={c} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${circuitos.has(c) ? 'border-acento text-texto' : 'border-borde text-texto-3'}`}>
              <input type="checkbox" className="sr-only" checked={circuitos.has(c)} onChange={() => toggle(c)} />
              {NOMBRE_CIRCUITO[c]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col text-xs text-texto-3">
          Superficie
          <select value={sup} onChange={(e) => setSup(e.target.value)} className="mt-1 rounded-md border border-borde bg-fondo px-2 py-1 text-sm text-texto">
            <option value="todas">Todas</option>
            {SUPERFICIES.map((s) => (
              <option key={s} value={s}>
                {NOMBRE_SUPERFICIE[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-texto-3">
          Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="mt-1 rounded-md border border-borde bg-fondo px-2 py-1 text-sm text-texto">
            <option value="todos">En curso y próximos</option>
            <option value="en curso">En curso</option>
            <option value="próximo">Próximos</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-texto-3">
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 rounded-md border border-borde bg-fondo px-2 py-1 text-sm text-texto" />
        </label>
        <label className="flex flex-col text-xs text-texto-3">
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 rounded-md border border-borde bg-fondo px-2 py-1 text-sm text-texto" />
        </label>
      </div>
      {error && <Aviso tipo="error">No se pudieron cargar los torneos: {error}</Aviso>}
      {!torneos && !error && <Cargando />}
      {torneos && (
        <p className="text-xs text-texto-3">
          {filtrados.length} torneos · datos de {origen === 'Supabase' ? 'Supabase' : 'la última actualización publicada'}
          {meta ? ` (${fechaHora(meta.generado)}, hora de Madrid)` : ''}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtrados.map((t) => (
          <Link key={t.id} to={`/torneo/${t.id}`} className="block">
            <Tarjeta className="h-full transition hover:border-texto-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <EtiquetaCircuito c={t.circuito} />
                <span className="text-xs text-texto-3">{t.categoria}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-xs ${t.estado === 'en curso' ? 'bg-ok/20 text-ok' : 'bg-superficie-2 text-texto-2'}`}>{t.estado}</span>
              </div>
              <h2 className="font-semibold">{t.nombre}</h2>
              <p className="text-sm text-texto-2">
                {t.ciudad}
                {t.pais ? `, ${t.pais}` : ''} · {fechaCorta(t.inicio)} – {fechaCorta(t.fin)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <EtiquetaSuperficie s={t.superficie} cubierta={t.cubierta} />
                <span className="text-xs text-texto-3">{t.nPartidos ? `${t.nPartidos} partidos` : 'Sin cuadro todavía'}</span>
                {t.tieneOrdenDeJuego && <span className="text-xs text-texto-3">· orden de juego</span>}
              </div>
              <p className="mt-2 text-[11px] text-texto-3">
                Fuente: {t.fuente} · actualizado {fechaHora(t.actualizado)}
              </p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </div>
  );
}
