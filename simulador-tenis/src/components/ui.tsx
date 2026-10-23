import type { ReactNode } from 'react';
import { NOMBRE_CIRCUITO, NOMBRE_SUPERFICIE, type Circuito, type Superficie } from '../../config/formatos';

export function Tarjeta({ titulo, children, extra, className = '' }: { titulo?: ReactNode; children: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-borde bg-superficie p-4 ${className}`}>
      {(titulo || extra) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-base font-semibold text-texto">{titulo}</h2>}
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-texto-2" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-texto-3 border-t-acento" />
      {texto}
    </div>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'aviso' | 'error'; children: ReactNode }) {
  const estilos = {
    info: 'border-borde bg-superficie-2 text-texto-2',
    aviso: 'border-aviso/60 bg-aviso/10 text-texto',
    error: 'border-error/60 bg-error/10 text-texto',
  }[tipo];
  const icono = { info: 'ℹ', aviso: '⚠', error: '✖' }[tipo];
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${estilos}`} role={tipo === 'error' ? 'alert' : undefined}>
      <span aria-hidden>{icono}</span>
      <div>{children}</div>
    </div>
  );
}

const COLOR_CIRCUITO: Record<Circuito, string> = {
  ATP: 'bg-[#1c5cab]/40 text-[#cde2fb]',
  WTA: 'bg-[#9085e9]/30 text-[#e3e0fb]',
  CH: 'bg-[#199e70]/30 text-[#c9f2e0]',
  W125: 'bg-[#d55181]/30 text-[#f8d4e2]',
};

export function EtiquetaCircuito({ c }: { c: Circuito }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${COLOR_CIRCUITO[c]}`}>{NOMBRE_CIRCUITO[c]}</span>;
}

const ICONO_SUP: Record<Superficie, string> = { dura: '🟦', tierra: '🟧', hierba: '🟩' };

export function EtiquetaSuperficie({ s, cubierta }: { s: Superficie | null; cubierta?: boolean | null }) {
  if (!s) return <span className="text-xs text-aviso">Superficie sin confirmar</span>;
  return (
    <span className="text-xs text-texto-2">
      <span aria-hidden>{ICONO_SUP[s]}</span> {NOMBRE_SUPERFICIE[s]}
      {cubierta === true ? ' · cubierta' : cubierta === false ? ' · exterior' : ''}
    </span>
  );
}

export function EtiquetaEstimado({ n, minimo }: { n: number; minimo: number }) {
  if (n >= minimo) return <span className="text-xs text-texto-3">{n} partidos con estadísticas</span>;
  return (
    <span className="rounded bg-aviso/20 px-1.5 py-0.5 text-xs text-aviso" title="Estimación a partir del Elo, la superficie y la media del circuito">
      ⚠ Estimado · {n} partidos con estadísticas
    </span>
  );
}

export function Boton({
  children,
  onClick,
  tipo = 'secundario',
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tipo?: 'primario' | 'secundario';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const base = 'rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const t = tipo === 'primario' ? 'bg-acento text-[#1a1a19] hover:brightness-110' : 'border border-borde bg-superficie-2 text-texto hover:border-texto-3';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${t} ${className}`} title={title}>
      {children}
    </button>
  );
}

export function Pestanas<T extends string>({ valor, opciones, onChange }: { valor: T; opciones: { id: T; texto: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-borde" role="tablist">
      {opciones.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={valor === o.id}
          onClick={() => onChange(o.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${valor === o.id ? 'border-acento text-texto' : 'border-transparent text-texto-2 hover:text-texto'}`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Bandera({ pais }: { pais: string }) {
  if (!pais) return null;
  return <span className="mr-1 rounded bg-superficie-2 px-1 text-[10px] font-semibold text-texto-3">{pais}</span>;
}
