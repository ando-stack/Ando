import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeamSnapshot } from '../../engine/snapshot';

interface Props {
  label: string;
  teams: TeamSnapshot[];
  value: string | null;
  exclude?: string | null;
  onChange: (id: string | null) => void;
  color: 'local' | 'visitante';
}

/** Selector de equipo con buscador (escribe para filtrar). */
export default function TeamPicker({ label, teams, value, exclude, onChange, color }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = teams.find((t) => t.id === value) ?? null;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = useMemo(
    () => teams.filter((t) => t.id !== exclude && (!q || norm(t.name + ' ' + t.short).includes(norm(q)))),
    [teams, q, exclude],
  );
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className={`block text-xs mb-1 ${color === 'local' ? 'text-local' : 'text-visitante'}`}>{label}</label>
      <input
        className="w-full"
        placeholder="Buscar equipo…"
        value={open ? q : current?.name ?? ''}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) {
            onChange(list[0].id);
            setOpen(false);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        aria-label={label}
      />
      {open && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-borde bg-panel shadow-xl">
          {list.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-800 flex items-center gap-2 ${t.id === value ? 'text-acento' : ''}`}
                onClick={() => {
                  onChange(t.id);
                  setOpen(false);
                }}
              >
                {t.logo ? <img src={t.logo} alt="" className="w-5 h-5 object-contain" loading="lazy" referrerPolicy="no-referrer" /> : <span className="w-5" />}
                <span className="flex-1">{t.name}</span>
                <span className="text-xs text-slate-500">
                  {t.current ? `${t.current.w}-${t.current.l}` : 'sin partidos'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
