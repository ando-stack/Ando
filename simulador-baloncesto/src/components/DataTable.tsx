import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv } from '../lib/format';

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
  /** Valor para CSV y para ordenar al pulsar la cabecera. */
  value: (row: T) => string | number;
}

interface Props<T> {
  title?: string;
  rows: T[];
  columns: Column<T>[];
  csvName: string;
  search?: (row: T) => string;
  teamOf?: (row: T) => string;
  teamOptions?: { value: string; label: string }[];
  pageSize?: number;
  extra?: ReactNode;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tabla con buscador, filtro por equipo, ordenación y exportación a CSV. */
export default function DataTable<T>({ title, rows, columns, csvName, search, teamOf, teamOptions, pageSize = 25, extra }: Props<T>) {
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Buscador en todas las tablas: por defecto busca en el texto de todas las columnas
  const searchFn = useMemo(() => search ?? ((x: T) => columns.map((c) => String(c.value(x))).join(' ')), [search, columns]);
  const filtered = useMemo(() => {
    let r = rows;
    if (q) r = r.filter((x) => norm(searchFn(x)).includes(norm(q)));
    if (team && teamOf) r = r.filter((x) => teamOf(x) === team);
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col)
        r = [...r].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * sort.dir;
        });
    }
    return r;
  }, [rows, q, team, searchFn, teamOf, sort, columns]);
  const exportCsv = () =>
    downloadCsv(
      `${csvName}.csv`,
      columns.map((c) => c.label),
      filtered.map((r) => columns.map((c) => c.value(r))),
    );
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {title && <h3 className="font-semibold text-white mr-auto">{title}</h3>}
        {extra}
        <input className="w-36 sm:w-44" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en la tabla" />
        {teamOf && teamOptions && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrar por equipo">
            <option value="">Todos</option>
            {teamOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={exportCsv} type="button">
          CSV
        </button>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.num ? 'text-right' : ''} cursor-pointer select-none hover:text-white`}
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: -1 }))}
                  title="Ordenar"
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/40">
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-slate-500">
                  Sin filas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          Mostrando {limit} de {filtered.length}
          <button className="btn" type="button" onClick={() => setLimit((l) => l + pageSize * 4)}>
            Mostrar más
          </button>
          <button className="btn" type="button" onClick={() => setLimit(filtered.length)}>
            Todas
          </button>
        </div>
      )}
    </div>
  );
}
