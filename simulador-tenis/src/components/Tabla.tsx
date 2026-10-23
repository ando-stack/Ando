import { useMemo, useState, type ReactNode } from 'react';
import { descargarCsv } from '../lib/formato';

export interface Columna<F> {
  id: string;
  titulo: string;
  valor: (f: F) => string | number;
  /** Texto para la celda (por defecto, el valor). */
  render?: (f: F) => ReactNode;
  alinear?: 'izq' | 'der';
}

/**
 * Tabla con buscador, filtro por jugador opcional y exportación a CSV.
 * Las filas llegan ya ordenadas de mayor a menor frecuencia.
 */
export function Tabla<F>({
  titulo,
  filas,
  columnas,
  archivo,
  filtroJugador,
  maxFilas = 15,
}: {
  titulo?: string;
  filas: F[];
  columnas: Columna<F>[];
  archivo: string;
  /** Si se indica, aparece un selector para filtrar por jugador. */
  filtroJugador?: { opciones: { id: string; texto: string }[]; aplica: (f: F, id: string) => boolean };
  maxFilas?: number;
}) {
  const [q, setQ] = useState('');
  const [jug, setJug] = useState('todos');
  const [todas, setTodas] = useState(false);
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((f) => {
      if (filtroJugador && jug !== 'todos' && !filtroJugador.aplica(f, jug)) return false;
      if (!t) return true;
      return columnas.some((c) => String(c.valor(f)).toLowerCase().includes(t));
    });
  }, [filas, q, jug, columnas, filtroJugador]);
  const mostradas = todas ? visibles : visibles.slice(0, maxFilas);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {titulo && <h3 className="mr-auto text-sm font-semibold text-texto">{titulo}</h3>}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          aria-label={`Buscar en ${titulo ?? 'la tabla'}`}
          className="w-32 rounded-md border border-borde bg-fondo px-2 py-1 text-xs text-texto placeholder:text-texto-3"
        />
        {filtroJugador && (
          <select
            value={jug}
            onChange={(e) => setJug(e.target.value)}
            aria-label="Filtrar por jugador"
            className="rounded-md border border-borde bg-fondo px-2 py-1 text-xs text-texto"
          >
            <option value="todos">Ambos jugadores</option>
            {filtroJugador.opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.texto}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => descargarCsv(archivo, columnas.map((c) => c.titulo), visibles.map((f) => columnas.map((c) => c.valor(f))))}
          className="rounded-md border border-borde px-2 py-1 text-xs text-texto-2 hover:text-texto"
        >
          CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="num w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-xs text-texto-3">
              {columnas.map((c) => (
                <th key={c.id} className={`px-2 py-1 font-medium ${c.alinear === 'izq' ? 'text-left' : 'text-right'}`}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mostradas.map((f, i) => (
              <tr key={i} className="border-b border-borde/40 hover:bg-superficie-2">
                {columnas.map((c) => (
                  <td key={c.id} className={`px-2 py-1 ${c.alinear === 'izq' ? 'text-left' : 'text-right'} text-texto`}>
                    {c.render ? c.render(f) : c.valor(f)}
                  </td>
                ))}
              </tr>
            ))}
            {!mostradas.length && (
              <tr>
                <td colSpan={columnas.length} className="px-2 py-3 text-center text-xs text-texto-3">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {visibles.length > maxFilas && (
        <button type="button" className="mt-1 text-xs text-acento hover:underline" onClick={() => setTodas(!todas)}>
          {todas ? 'Mostrar menos' : `Mostrar las ${visibles.length} filas`}
        </button>
      )}
    </div>
  );
}
