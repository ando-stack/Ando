import { Pipette } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useEditor } from '../store';
import { esHex } from '../utils/color';

export function Boton({ children, onClick, activo, titulo, className = '', deshabilitado, tipo = 'normal', testid }: {
  children: ReactNode;
  onClick?: () => void;
  activo?: boolean;
  titulo?: string;
  className?: string;
  deshabilitado?: boolean;
  tipo?: 'normal' | 'primario' | 'peligro';
  testid?: string;
}) {
  const estilos = {
    normal: activo ? 'bg-acento/25 text-white ring-1 ring-acento' : 'bg-panel2 hover:bg-borde text-texto',
    primario: 'bg-acento hover:bg-acento/80 text-white',
    peligro: 'bg-peligro/80 hover:bg-peligro text-white',
  }[tipo];
  return (
    <button
      type="button"
      data-testid={testid}
      title={titulo}
      aria-label={typeof children === 'string' ? undefined : titulo}
      disabled={deshabilitado}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${estilos} ${className}`}
    >
      {children}
    </button>
  );
}

export function Seccion({ titulo, children, abierta = true, extra }: { titulo: string; children: ReactNode; abierta?: boolean; extra?: ReactNode }) {
  const [a, setA] = useState(abierta);
  return (
    <div className="border-b border-borde">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" className="flex-1 text-left text-[11px] font-semibold uppercase tracking-wide text-tenue hover:text-texto" onClick={() => setA(!a)}>
          {a ? '▾' : '▸'} {titulo}
        </button>
        {extra}
      </div>
      {a && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Deslizador({ etiqueta, valor, min, max, paso = 1, onChange, sufijo = '', clave }: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso?: number;
  onChange: (v: number, clave: string) => void;
  sufijo?: string;
  clave: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-tenue">{etiqueta}</span>
      <input type="range" className="h-1 flex-1 accent-acento" min={min} max={max} step={paso} value={valor} onChange={(e) => onChange(Number(e.target.value), clave)} />
      <input
        type="number"
        className="w-14 rounded bg-panel2 px-1 py-0.5 text-right text-xs"
        min={min}
        max={max}
        step={paso}
        value={Math.round(valor * 100) / 100}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v, clave);
        }}
      />
      {sufijo && <span className="w-4 text-tenue">{sufijo}</span>}
    </label>
  );
}

export function Numero({ etiqueta, valor, onChange, paso = 1, ancho = 'w-16' }: { etiqueta: string; valor: number; onChange: (v: number) => void; paso?: number; ancho?: string }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-tenue">{etiqueta}</span>
      <input
        type="number"
        step={paso}
        className={`${ancho} rounded bg-panel2 px-1 py-0.5 text-xs`}
        value={Math.round(valor * 100) / 100}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function Interruptor({ etiqueta, valor, onChange }: { etiqueta: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" className="accent-acento" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  );
}

export function Selector<T extends string>({ etiqueta, valor, opciones, onChange }: { etiqueta?: string; valor: T; opciones: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      {etiqueta && <span className="w-24 shrink-0 text-tenue">{etiqueta}</span>}
      <select className="flex-1 rounded bg-panel2 px-1 py-1 text-xs" value={valor} onChange={(e) => onChange(e.target.value as T)}>
        {opciones.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
    </label>
  );
}

const BASICOS = ['#ffffff', '#000000', '#ffe600', '#ff7a00', '#e3122c', '#22c55e', '#00e5ff', '#1d4ed8', '#7c3aed', '#ec4899'];

/** Selector de color con cuentagotas (del lienzo o de la pantalla) y paleta del original. */
export function SelectorColor({ etiqueta, valor, onChange, clave }: { etiqueta: string; valor: string; onChange: (c: string, clave: string) => void; clave: string }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(valor);
  const paleta = useEditor((s) => s.doc.palette);
  const cuentagotas = async () => {
    const W = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
    if (W.EyeDropper) {
      try {
        const r = await new W.EyeDropper().open();
        onChange(r.sRGBHex, clave + ':gotas');
      } catch {
        /* cancelado */
      }
      return;
    }
    useEditor.getState().set({ herramienta: 'eyedropper', cuentagotas: (c) => onChange(c, clave + ':gotas') });
    useEditor.getState().avisar('Haz clic en el lienzo para tomar un color.', 'info');
  };
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-tenue">{etiqueta}</span>
        <button type="button" title="Elegir color" className="h-6 w-8 rounded border border-borde" style={{ background: valor }} onClick={() => setAbierto(!abierto)} />
        <input
          className="w-20 rounded bg-panel2 px-1 py-0.5 font-mono text-xs"
          value={abierto ? texto : valor}
          onFocus={() => setTexto(valor)}
          onChange={(e) => {
            setTexto(e.target.value);
            if (esHex(e.target.value)) onChange(e.target.value, clave);
          }}
        />
        <button type="button" title="Cuentagotas" className="rounded p-1 hover:bg-borde" onClick={cuentagotas}>
          <Pipette size={14} />
        </button>
      </div>
      {abierto && (
        <div className="mt-2 space-y-2 rounded bg-panel2 p-2">
          <input type="color" className="h-8 w-full cursor-pointer bg-transparent" value={esHex(valor) && valor.length === 7 ? valor : '#000000'} onChange={(e) => onChange(e.target.value, clave)} />
          {paleta.length > 0 && (
            <div>
              <div className="mb-1 text-xxs text-tenue">Paleta de la imagen original</div>
              <div className="flex flex-wrap gap-1">
                {paleta.map((c) => (
                  <button type="button" key={c} title={c} className="h-5 w-5 rounded border border-borde" style={{ background: c }} onClick={() => onChange(c, clave + ':pal')} />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {BASICOS.map((c) => (
              <button type="button" key={c} title={c} className="h-5 w-5 rounded border border-borde" style={{ background: c }} onClick={() => onChange(c, clave + ':bas')} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Modal({ titulo, children, onCerrar, ancho = 'max-w-lg' }: { titulo: string; children: ReactNode; onCerrar: () => void; ancho?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCerrar} role="dialog" aria-label={titulo}>
      <div className={`max-h-[90vh] w-full ${ancho} overflow-auto rounded-lg border border-borde bg-panel shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-borde px-4 py-3">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          <button type="button" className="text-tenue hover:text-texto" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
