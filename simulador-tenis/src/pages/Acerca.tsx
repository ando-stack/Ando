import { useEffect, useState } from 'react';
import { FORMATOS } from '../../config/formatos';
import { Tarjeta } from '../components/ui';
import { cargarMeta } from '../lib/datos';
import { fechaHora, num, pct } from '../lib/formato';
import type { MetaDatos } from '../lib/tiposDatos';

const NOMBRE_COBERTURA: Record<string, string> = {
  'M-ATP': 'ATP',
  'M-CH': 'ATP Challenger',
  'F-WTA': 'WTA',
  'F-W125': 'WTA 125',
  'M-ITF': 'ITF masculino',
  'F-ITF': 'ITF femenino',
  'M-OTRO': 'Copa Davis',
  'F-OTRO': 'Billie Jean King Cup',
};

interface FilaValidacion {
  grupo: string;
  n: number;
  logLoss: number;
  brier: number;
  logLossElo?: number;
  aciertos: number;
}

export default function Acerca() {
  const [meta, setMeta] = useState<MetaDatos | null>(null);
  const [val, setVal] = useState<{ temporada: string; filas: FilaValidacion[] } | null>(null);
  useEffect(() => {
    cargarMeta().then(setMeta).catch(() => undefined);
    fetch('/data/validacion.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setVal)
      .catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Acerca del simulador</h1>
      <Tarjeta titulo="Qué hace">
        <p className="text-sm text-texto-2">
          Simula partidos de individuales punto a punto (método de Monte Carlo). Para cada partido estima la probabilidad de cada jugador de ganar un punto con su saque, combinando su
          rendimiento al saque, el del rival al resto y la media del circuito en la superficie (método de Barnett y Clarke), y la ajusta para que la probabilidad de victoria coincida
          con una mezcla del Elo de superficie (con la forma reciente) y las estadísticas. Cada punto se juega con primer y segundo saque, aces y dobles faltas, y cada simulación
          varía ligeramente el nivel de los jugadores para no subestimar las sorpresas.
        </p>
        <p className="mt-2 text-sm font-semibold text-aviso">Los resultados son probabilidades simuladas, no predicciones seguras. No es asesoramiento de apuestas. +18 · Juego responsable.</p>
      </Tarjeta>
      <Tarjeta titulo="Fuentes de datos y licencias">
        <ul className="list-disc space-y-1 pl-5 text-sm text-texto-2">
          <li>
            <strong>Histórico de partidos y estadísticas:</strong> Jeff Sackmann, tennis_atp y tennis_wta, licencia <strong>CC BY-NC-SA 4.0: sólo uso no comercial</strong>, con
            atribución y compartir igual. Los repositorios originales dejaron de estar disponibles a mediados de 2026; se usa un espejo de archivo en Hugging Face.
          </li>
          <li>
            <strong>WTA y WTA 125:</strong> API pública de wtatennis.com (calendario, cuadros, orden de juego, resultados y estadísticas). Sin términos específicos para terceros: uso no
            comercial, con caché y pocas peticiones.
          </li>
          <li>
            <strong>ATP Tour:</strong> ESPN (cuadros, horarios y resultados; sin estadísticas de saque). Uso no comercial con caché.
          </li>
          <li>
            <strong>ATP Challenger y superficies del ATP Tour:</strong> Wikipedia (CC BY-SA 4.0). Los cuadros los mantienen voluntarios y no incluyen horarios: el orden de juego de los
            Challenger no está disponible porque atptour.com bloquea el acceso automatizado.
          </li>
        </ul>
      </Tarjeta>
      {meta && (
        <Tarjeta titulo={`Estado de las fuentes · actualización ${fechaHora(meta.generado)}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-texto-3">
                <th className="text-left font-medium">Fuente</th>
                <th className="text-left font-medium">Estado</th>
                <th className="text-left font-medium">Último éxito</th>
                <th className="text-right font-medium">Registros</th>
              </tr>
            </thead>
            <tbody>
              {meta.fuentes.map((f) => (
                <tr key={f.fuente} className="border-t border-borde/40">
                  <td className="py-1 text-texto-2" title={f.descripcion}>
                    {f.descripcion}
                  </td>
                  <td className={f.ok ? 'text-ok' : 'text-error'}>{f.ok ? 'correcto' : `error: ${f.error}`}</td>
                  <td>{fechaHora(f.ultimoExito)}</td>
                  <td className="num text-right">{f.registros.toLocaleString('es-ES')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-texto-3">
            Histórico: {meta.historico.partidos.toLocaleString('es-ES')} partidos desde {meta.historico.desde} ({meta.historico.conEstadisticas.toLocaleString('es-ES')} con estadísticas
            detalladas). Último partido por circuito: {Object.entries(meta.historico.hasta).map(([k, v]) => `${NOMBRE_COBERTURA[k] ?? k} ${v}`).join(' · ')}.
          </p>
        </Tarjeta>
      )}
      <Tarjeta titulo="Formatos de partido">
        <ul className="space-y-1 text-sm text-texto-2">
          {Object.values(FORMATOS).map((f) => (
            <li key={f.id}>
              <strong className="text-texto">{f.nombre}</strong> — {f.fuente}
            </li>
          ))}
        </ul>
      </Tarjeta>
      {val && (
        <Tarjeta titulo={`Validación (backtest de la temporada ${val.temporada})`}>
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-xs text-texto-3">
                <th className="text-left font-medium">Grupo</th>
                <th className="text-right font-medium">Partidos</th>
                <th className="text-right font-medium">Log loss</th>
                <th className="text-right font-medium">Brier</th>
                <th className="text-right font-medium">Aciertos</th>
              </tr>
            </thead>
            <tbody>
              {val.filas.map((f) => (
                <tr key={f.grupo} className="border-t border-borde/40">
                  <td className="py-1">{f.grupo}</td>
                  <td className="text-right">{f.n.toLocaleString('es-ES')}</td>
                  <td className="text-right">{num(f.logLoss, 3)}</td>
                  <td className="text-right">{num(f.brier, 3)}</td>
                  <td className="text-right">{pct(f.aciertos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-texto-3">Detalle completo en docs/validacion.md.</p>
        </Tarjeta>
      )}
    </div>
  );
}
