import { useMemo, useState } from 'react';
import { NOMBRE_CIRCUITO, type Circuito } from '../../config/formatos';
import type { EntradaIndice } from '../lib/tiposDatos';
import { Bandera } from './ui';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function SelectorJugador({
  indice,
  valor,
  onChange,
  etiqueta,
  pool,
  color,
}: {
  indice: EntradaIndice[];
  valor: EntradaIndice | null;
  onChange: (j: EntradaIndice) => void;
  etiqueta: string;
  pool?: 'M' | 'F';
  color: string;
}) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const opciones = useMemo(() => {
    const t = norm(q.trim());
    const base = pool ? indice.filter((j) => j.pool === pool) : indice;
    if (!t) return base.slice(0, 20);
    const partes = t.split(/\s+/);
    return base.filter((j) => partes.every((p) => norm(j.nombre).includes(p))).slice(0, 20);
  }, [q, indice, pool]);
  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium" style={{ color }}>
        {etiqueta}
      </label>
      <input
        value={abierto ? q : (valor?.nombre ?? q)}
        onFocus={() => {
          setAbierto(true);
          setQ('');
        }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Escribe un nombre…"
        className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto"
        aria-label={etiqueta}
      />
      {abierto && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-borde bg-superficie-2 shadow-lg" role="listbox">
          {opciones.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange(j);
                  setAbierto(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-superficie"
              >
                <Bandera pais={j.pais} />
                <span className="flex-1 truncate">{j.nombre}</span>
                <span className="text-xs text-texto-3">
                  {j.rank ? `#${j.rank}` : 's/r'} · {NOMBRE_CIRCUITO[j.circuito as Circuito] ?? j.circuito} · Elo {j.elo}
                </span>
              </button>
            </li>
          ))}
          {!opciones.length && <li className="px-3 py-2 text-xs text-texto-3">Sin coincidencias</li>}
        </ul>
      )}
    </div>
  );
}
