import type { JSX } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Combine, Copy, Eye, EyeOff, Folder, Group as GroupIcon, Image as ImageIcon, Lock, Scissors, Shapes, Trash2, Type, Ungroup, Unlock } from 'lucide-react';
import { useState } from 'react';
import { dividirSeleccion, unirSeleccion } from '../acciones';
import { useEditor } from '../store';
import type { BlendMode, Layer } from '../types';
import { Boton, Selector } from './controles';

export const MODOS_FUSION: { v: BlendMode; t: string }[] = [
  { v: 'source-over', t: 'Normal' },
  { v: 'multiply', t: 'Multiplicar' },
  { v: 'screen', t: 'Trama' },
  { v: 'overlay', t: 'Superponer' },
  { v: 'darken', t: 'Oscurecer' },
  { v: 'lighten', t: 'Aclarar' },
  { v: 'color-dodge', t: 'Sobreexponer color' },
  { v: 'color-burn', t: 'Subexponer color' },
  { v: 'hard-light', t: 'Luz fuerte' },
  { v: 'soft-light', t: 'Luz suave' },
  { v: 'difference', t: 'Diferencia' },
  { v: 'exclusion', t: 'Exclusión' },
  { v: 'hue', t: 'Tono' },
  { v: 'saturation', t: 'Saturación' },
  { v: 'color', t: 'Color' },
  { v: 'luminosity', t: 'Luminosidad' },
];

const ROLES: Record<string, string> = {
  fondo: 'Fondo',
  sujeto: 'Sujeto',
  objeto: 'Objeto',
  texto: 'Texto',
  'texto-imagen': 'Texto (imagen)',
  grafico: 'Gráfico',
  original: 'Referencia',
  usuario: '',
  efecto: 'Efecto',
};

function Icono({ l }: { l: Layer }) {
  if (l.type === 'text') return <Type size={14} />;
  if (l.type === 'shape') return <Shapes size={14} />;
  return <ImageIcon size={14} />;
}

function Confianza({ v }: { v?: number | null }) {
  if (v === null || v === undefined) return null;
  const color = v >= 0.75 ? 'bg-ok' : v >= 0.5 ? 'bg-aviso' : 'bg-peligro';
  return (
    <span title={`Confianza de la IA: ${Math.round(v * 100)}%`} className="flex items-center gap-1 text-xxs text-tenue">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {Math.round(v * 100)}%
    </span>
  );
}

export function PanelCapas() {
  const e = useEditor();
  const { doc, seleccion } = e;
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<{ id: string; antes: boolean } | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const invertidas = [...doc.layers].reverse(); // la de arriba primero
  const sel = doc.layers.filter((l) => seleccion.includes(l.id));
  const una = sel.length === 1 ? sel[0] : null;

  const soltar = (destino: string, antes: boolean) => {
    if (!arrastrando || arrastrando === destino) return;
    const capas = doc.layers;
    const mover = seleccion.includes(arrastrando) ? capas.filter((l) => seleccion.includes(l.id)).map((l) => l.id) : [arrastrando];
    e.cambiar((d) => {
      const quedan = d.layers.filter((l) => !mover.includes(l.id));
      const movidas = d.layers.filter((l) => mover.includes(l.id));
      const destinoCapa = d.layers.find((l) => l.id === destino);
      let i = quedan.findIndex((l) => l.id === destino);
      if (i < 0) return d;
      // en la lista (de arriba a abajo) «antes» significa por encima → índice mayor en el array
      if (antes) i += 1;
      const resultado = [...quedan.slice(0, i), ...movidas.map((m) => ({ ...m, groupId: destinoCapa?.groupId ?? null })), ...quedan.slice(i)];
      return { ...d, layers: resultado };
    });
  };

  const grupoDe = (gid?: string | null) => doc.groups.find((g) => g.id === gid);
  const filas: JSX.Element[] = [];
  let grupoActual: string | null = null;
  for (const l of invertidas) {
    const g = grupoDe(l.groupId);
    if (g && grupoActual !== g.id) {
      grupoActual = g.id;
      const miembros = doc.layers.filter((x) => x.groupId === g.id).map((x) => x.id);
      const todosVisibles = doc.layers.filter((x) => x.groupId === g.id).every((x) => x.visible);
      filas.push(
        <div key={'g' + g.id} className={`flex items-center gap-1 px-2 py-1 text-xs ${miembros.every((m) => seleccion.includes(m)) ? 'bg-acento/20' : 'hover:bg-panel2'}`} onClick={() => e.seleccionar(miembros)}>
          <button type="button" aria-label="Plegar grupo" onClick={(ev) => { ev.stopPropagation(); e.cambiar((d) => ({ ...d, groups: d.groups.map((x) => (x.id === g.id ? { ...x, collapsed: !x.collapsed } : x)) })); }}>
            {g.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" aria-label="Mostrar u ocultar grupo" onClick={(ev) => { ev.stopPropagation(); e.actualizarCapas(miembros, () => ({ visible: !todosVisibles })); }}>
            {todosVisibles ? <Eye size={14} /> : <EyeOff size={14} className="text-tenue" />}
          </button>
          <Folder size={14} className="text-aviso" />
          {renombrando === g.id ? (
            <input autoFocus className="flex-1 rounded bg-panel2 px-1" defaultValue={g.name} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} onBlur={(ev) => { const v = ev.target.value.trim(); if (v) e.cambiar((d) => ({ ...d, groups: d.groups.map((x) => (x.id === g.id ? { ...x, name: v } : x)) })); setRenombrando(null); }} />
          ) : (
            <span className="flex-1 truncate" onDoubleClick={() => setRenombrando(g.id)}>{g.name}</span>
          )}
        </div>,
      );
    }
    if (!g) grupoActual = null;
    if (g?.collapsed) continue;
    const seleccionada = seleccion.includes(l.id);
    filas.push(
      <div
        key={l.id}
        data-testid="fila-capa"
        draggable
        onDragStart={(ev) => {
          setArrastrando(l.id);
          ev.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          setArrastrando(null);
          setSobre(null);
        }}
        onDragOver={(ev) => {
          ev.preventDefault();
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          setSobre({ id: l.id, antes: ev.clientY < r.top + r.height / 2 });
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          if (sobre) soltar(sobre.id, sobre.antes);
          setSobre(null);
        }}
        onClick={(ev) => e.seleccionar([l.id], ev.shiftKey || ev.ctrlKey || ev.metaKey)}
        className={`group flex items-center gap-1 border-y px-2 py-1 text-xs ${g ? 'pl-6' : ''} ${seleccionada ? 'bg-acento/25' : 'hover:bg-panel2'} ${sobre?.id === l.id ? (sobre.antes ? 'border-t-acento border-b-transparent' : 'border-b-acento border-t-transparent') : 'border-transparent'} ${!l.visible ? 'opacity-60' : ''}`}
      >
        <button type="button" aria-label={l.visible ? 'Ocultar capa' : 'Mostrar capa'} title={l.visible ? 'Ocultar' : 'Mostrar'} onClick={(ev) => { ev.stopPropagation(); e.actualizarCapa(l.id, { visible: !l.visible }); }}>
          {l.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-tenue" />}
        </button>
        <span className="text-tenue"><Icono l={l} /></span>
        {renombrando === l.id ? (
          <input
            autoFocus
            className="min-w-0 flex-1 rounded bg-panel2 px-1"
            defaultValue={l.name}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter' || ev.key === 'Escape') (ev.target as HTMLInputElement).blur();
            }}
            onBlur={(ev) => {
              const v = ev.target.value.trim();
              if (v && v !== l.name) e.actualizarCapa(l.id, { name: v });
              setRenombrando(null);
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate" title={`${l.name}${ROLES[l.role ?? ''] ? ' · ' + ROLES[l.role ?? ''] : ''} (doble clic para renombrar)`} onDoubleClick={() => setRenombrando(l.id)}>
            {l.name}
          </span>
        )}
        {!!l.warnings?.length && (
          <span title={l.warnings.join('\n')}>
            <AlertTriangle size={13} className="text-aviso" />
          </span>
        )}
        <Confianza v={l.confidence} />
        <button type="button" aria-label={l.locked ? 'Desbloquear capa' : 'Bloquear capa'} title={l.locked ? 'Desbloquear' : 'Bloquear'} className={l.locked ? '' : 'opacity-0 group-hover:opacity-100'} onClick={(ev) => { ev.stopPropagation(); e.actualizarCapa(l.id, { locked: !l.locked }); }}>
          {l.locked ? <Lock size={13} className="text-aviso" /> : <Unlock size={13} className="text-tenue" />}
        </button>
      </div>,
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-borde px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-tenue">Capas ({doc.layers.length})</span>
      </div>
      {sel.length > 0 && (
        <div className="space-y-2 border-b border-borde px-3 py-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="w-16 text-tenue">Opacidad</span>
            <input type="range" min={0} max={1} step={0.01} className="flex-1 accent-acento" value={una?.opacity ?? sel[0].opacity} onChange={(ev) => e.actualizarCapas(seleccion, () => ({ opacity: Number(ev.target.value) }), 'opacidad')} />
            <span className="w-8 text-right">{Math.round((una?.opacity ?? sel[0].opacity) * 100)}%</span>
          </label>
          <Selector etiqueta="Fusión" valor={(una ?? sel[0]).blendMode} opciones={MODOS_FUSION} onChange={(v) => e.actualizarCapas(seleccion, () => ({ blendMode: v }))} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="lista-capas">
        {filas}
        {!doc.layers.length && <p className="px-3 py-4 text-center text-xs text-tenue">Sin capas. Sube una imagen de inspiración o añade texto, formas e imágenes.</p>}
      </div>
      <div className="flex flex-wrap gap-1 border-t border-borde p-2">
        <Boton titulo="Duplicar (Ctrl+D)" deshabilitado={!sel.length} onClick={e.duplicarSeleccion}><Copy size={14} /></Boton>
        <Boton titulo="Agrupar (Ctrl+G)" deshabilitado={sel.length < 2} onClick={e.agrupar}><GroupIcon size={14} /></Boton>
        <Boton titulo="Desagrupar (Ctrl+Shift+G)" deshabilitado={!sel.some((l) => l.groupId)} onClick={e.desagrupar}><Ungroup size={14} /></Boton>
        <Boton titulo="Unir capas (Ctrl+E)" deshabilitado={sel.length < 2} onClick={() => unirSeleccion()}><Combine size={14} /></Boton>
        <Boton titulo="Dividir capa en partes" deshabilitado={!(una?.type === 'image')} onClick={() => dividirSeleccion()}><Scissors size={14} /></Boton>
        <Boton titulo="Eliminar (Supr)" tipo="normal" deshabilitado={!sel.length || sel.every((l) => l.locked)} onClick={e.borrarSeleccion}><Trash2 size={14} /></Boton>
      </div>
    </div>
  );
}
