import React, {useEffect, useState} from 'react';
import {api} from '../api';

export const Row: React.FC<{label: string; children: React.ReactNode}> = ({label, children}) => (
  <label className="flex items-center gap-2 text-xs py-1">
    <span className="w-28 shrink-0 text-zinc-400">{label}</span>
    <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
  </label>
);

export function Num({label, value, onChange, min, max, step = 0.01, slider = true}: {label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; slider?: boolean}) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <Row label={label}>
      {slider && <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0" />}
      <input
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const v = Number(txt.replace(',', '.'));
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          else setTxt(String(value));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={`${slider ? 'w-16' : 'flex-1'} bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-right`}
      />
    </Row>
  );
}

export function Text({label, value, onChange, area}: {label: string; value: string; onChange: (v: string) => void; area?: boolean}) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const common = {
    value: txt,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setTxt(e.target.value),
    onBlur: () => txt !== value && txt.trim() && onChange(txt),
    className: 'w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1',
  };
  return <Row label={label}>{area ? <textarea rows={2} {...common} /> : <input {...common} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}</Row>;
}

export function Select<T extends string>({label, value, options, onChange}: {label: string; value: T; options: [T, string][]; onChange: (v: T) => void}) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-1 py-1">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function Check({label, value, onChange}: {label: string; value: boolean; onChange: (v: boolean) => void}) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

export function ColorField({label, value, onChange, allowNone}: {label: string; value: string | null | undefined; onChange: (v: string | null) => void; allowNone?: boolean}) {
  const hex = (value ?? '#000000').slice(0, 7);
  const alpha = value && value.length === 9 ? value.slice(7) : '';
  return (
    <Row label={label}>
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value + alpha)} disabled={!value && allowNone} className="w-8 h-6 bg-transparent" />
      <span className="text-zinc-500">{value ?? 'ninguno'}</span>
      {allowNone && (
        <button className="text-zinc-400 hover:text-white underline" onClick={(e) => (e.preventDefault(), onChange(value ? null : '#000000CC'))}>
          {value ? 'quitar' : 'añadir'}
        </button>
      )}
    </Row>
  );
}

export interface Library {
  emojis: {emoji: string; file: string; keywords: string}[];
  music: string[];
  sfx: string[];
  fonts: string[];
  captionPresets: string[];
}

let libPromise: Promise<Library> | null = null;
export function useLibrary(): Library | null {
  const [lib, setLib] = useState<Library | null>(null);
  useEffect(() => {
    libPromise ??= api.get<Library>('/api/library');
    libPromise.then(setLib).catch(() => undefined);
  }, []);
  return lib;
}

export const Section: React.FC<{title: string; children: React.ReactNode; right?: React.ReactNode}> = ({title, children, right}) => (
  <div className="mb-4">
    <div className="flex items-center justify-between mb-1">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary' | 'normal' | 'danger'}> = ({variant = 'normal', className = '', ...rest}) => (
  <button
    {...rest}
    className={`text-xs px-2.5 py-1.5 rounded disabled:opacity-40 ${variant === 'primary' ? 'bg-pink-600 hover:bg-pink-500 font-semibold' : variant === 'danger' ? 'bg-red-800 hover:bg-red-700' : 'bg-zinc-800 hover:bg-zinc-700'} ${className}`}
  />
);
