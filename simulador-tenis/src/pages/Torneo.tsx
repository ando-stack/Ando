import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FORMATOS } from '../../config/formatos';
import { TarjetaPartido } from '../components/TarjetaPartido';
import { Aviso, Cargando, EtiquetaCircuito, EtiquetaSuperficie, Pestanas } from '../components/ui';
import { cargarTorneo } from '../lib/datos';
import { diaMadrid, fechaCorta, fechaHora } from '../lib/formato';
import type { DetalleTorneo, PartidoVivo } from '../lib/tiposDatos';

const ORDEN_RONDAS = ['Q1', 'Q2', 'Q3', 'Q4', 'R128', 'R64', 'R48', 'R32', 'R16', 'RR', 'QF', 'SF', 'F'];
const ordenRonda = (r: string) => {
  const i = ORDEN_RONDAS.indexOf(r);
  return i < 0 ? 50 : i;
};

export default function Torneo() {
  const { id = '' } = useParams();
  const [d, setD] = useState<DetalleTorneo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<'orden' | 'cuadro' | 'previa'>('orden');
  const [dia, setDia] = useState<string>('');

  useEffect(() => {
    setD(null);
    cargarTorneo(id)
      .then((x) => {
        setD(x);
        const dias = [...new Set(x.partidos.filter((p) => p.hora && p.estado !== 'terminado').map((p) => diaMadrid(p.hora!)))].sort();
        setDia(dias[0] ?? '');
        if (!x.partidos.some((p) => p.hora)) setVista('cuadro');
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const dias = useMemo(() => {
    if (!d) return [];
    return [...new Set(d.partidos.filter((p) => p.hora).map((p) => diaMadrid(p.hora!)))].sort();
  }, [d]);

  if (error) return <Aviso tipo="error">No se pudo cargar el torneo: {error}</Aviso>;
  if (!d) return <Cargando />;
  const t = d.torneo;
  const porRonda = (fase: 'Q' | 'M') => {
    const m = new Map<string, PartidoVivo[]>();
    for (const p of d.partidos.filter((x) => x.fase === fase)) m.set(p.ronda, [...(m.get(p.ronda) ?? []), p]);
    return [...m.entries()].sort((a, b) => ordenRonda(a[0]) - ordenRonda(b[0]));
  };
  const delDia = d.partidos
    .filter((p) => p.hora && diaMadrid(p.hora) === dia)
    .sort((a, b) => (a.pista ?? '').localeCompare(b.pista ?? '') || (a.hora ?? '').localeCompare(b.hora ?? ''));
  const pistas = [...new Set(delDia.map((p) => p.pista ?? 'Pista sin asignar'))];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetaCircuito c={t.circuito} />
          <span className="text-sm text-texto-3">{t.categoria}</span>
        </div>
        <h1 className="mt-1 text-xl font-semibold">{t.nombre}</h1>
        <p className="text-sm text-texto-2">
          {t.ciudad}
          {t.pais ? `, ${t.pais}` : ''} · {fechaCorta(t.inicio)} – {fechaCorta(t.fin)} · <EtiquetaSuperficie s={t.superficie} cubierta={t.cubierta} />
        </p>
        <p className="text-xs text-texto-3">
          Formato: {FORMATOS[t.formatoId]?.nombre}
          {t.formatoQualyId !== t.formatoId ? ` · previa: ${FORMATOS[t.formatoQualyId]?.nombre}` : ''}
        </p>
        <p className="text-xs text-texto-3">
          Fuente: {t.fuente} · actualizado {fechaHora(t.actualizado)} (hora de Madrid)
        </p>
      </div>
      {t.avisos.map((a) => (
        <Aviso key={a} tipo="aviso">
          {a}
        </Aviso>
      ))}
      <Pestanas
        valor={vista}
        onChange={setVista}
        opciones={[
          { id: 'orden', texto: 'Orden de juego' },
          { id: 'cuadro', texto: 'Cuadro final' },
          { id: 'previa', texto: 'Fase previa' },
        ]}
      />
      {vista === 'orden' &&
        (dias.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {dias.map((x) => (
                <button key={x} onClick={() => setDia(x)} className={`rounded-full border px-3 py-1 text-xs ${x === dia ? 'border-acento text-texto' : 'border-borde text-texto-2'}`}>
                  {fechaCorta(x)}
                </button>
              ))}
            </div>
            <p className="text-xs text-texto-3">Horas en zona Europe/Madrid.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {pistas.map((pista) => (
                <div key={pista} className="space-y-2">
                  <h3 className="text-sm font-semibold text-texto-2">{pista}</h3>
                  {delDia
                    .filter((p) => (p.pista ?? 'Pista sin asignar') === pista)
                    .map((p) => (
                      <TarjetaPartido key={p.id} p={p} t={t} conHora />
                    ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Aviso>Orden de juego no disponible para este torneo.</Aviso>
        ))}
      {(vista === 'cuadro' || vista === 'previa') && (
        <div className="space-y-4">
          {porRonda(vista === 'cuadro' ? 'M' : 'Q').map(([ronda, ps]) => (
            <div key={ronda}>
              <h3 className="mb-2 text-sm font-semibold text-texto-2">
                {ronda} · {ps.length} partidos
              </h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {ps
                  .sort((a, b) => a.orden - b.orden)
                  .map((p) => (
                    <TarjetaPartido key={p.id} p={p} t={t} conHora={p.estado !== 'terminado'} />
                  ))}
              </div>
            </div>
          ))}
          {!porRonda(vista === 'cuadro' ? 'M' : 'Q').length && <Aviso>Todavía no hay partidos publicados en esta fase.</Aviso>}
        </div>
      )}
    </div>
  );
}
