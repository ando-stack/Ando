import { Link, useParams } from 'react-router-dom';
import { FORMATOS, NOMBRE_SUPERFICIE, type Superficie } from '../../config/formatos';
import { PanelResultados } from '../components/Resultados';
import { Aviso, Tarjeta } from '../components/ui';
import { entero, fechaHora, pct } from '../lib/formato';
import { obtenerSimulacion } from '../lib/guardadas';

export default function Resultados() {
  const { id = 'ultima' } = useParams();
  const s = obtenerSimulacion(id);
  if (!s) return <Aviso>No se encontró esta simulación en este navegador. <Link to="/historial" className="text-acento">Ver historial</Link></Aviso>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{s.titulo}</h1>
        <p className="text-sm text-texto-2">
          {NOMBRE_SUPERFICIE[s.contexto.superficie as Superficie]}
          {s.contexto.cubierta === true ? ' (cubierta)' : s.contexto.cubierta === false ? ' (exterior)' : ''} · {FORMATOS[s.contexto.formatoId]?.nombre} · {entero(s.n)} simulaciones · semilla {s.semilla} ·{' '}
          {fechaHora(s.fecha)}
        </p>
        <p className="text-xs text-texto-3">
          Modelo: Elo {pct(s.detalle.pElo)} · estadísticas {pct(s.detalle.pEstadisticas)} · combinado {pct(s.detalle.pFormato)} para {s.a.nombre}
          {(s.detalle.estimadoA || s.detalle.estimadoB) && ' · incluye datos estimados'}
        </p>
      </div>
      <Tarjeta>
        <PanelResultados r={s.resultados} nombreA={s.a.nombre} nombreB={s.b.nombre} />
      </Tarjeta>
    </div>
  );
}
