import type { JSX } from 'react';
import { ArrowRight, Brush, Circle, Eraser, Hand, Image as ImageIcon, MousePointer2, Pipette, ScanEye, Shapes, Sparkles, Square, Star, Type, Award, Minus, RectangleHorizontal } from 'lucide-react';
import { useEditor } from '../store';
import type { Tool } from '../types';
import { useSegmento } from '../canvas/refs';

const HERRAMIENTAS: { t: Tool; icono: JSX.Element; nombre: string; tecla: string }[] = [
  { t: 'select', icono: <MousePointer2 size={18} />, nombre: 'Seleccionar y transformar', tecla: 'V' },
  { t: 'hand', icono: <Hand size={18} />, nombre: 'Mano (desplazar)', tecla: 'H / Espacio' },
  { t: 'text', icono: <Type size={18} />, nombre: 'Texto', tecla: 'T' },
  { t: 'shape', icono: <Shapes size={18} />, nombre: 'Formas', tecla: 'U' },
  { t: 'mask-hide', icono: <Eraser size={18} />, nombre: 'Borrador (máscara: ocultar)', tecla: 'E' },
  { t: 'mask-show', icono: <Brush size={18} />, nombre: 'Pincel de máscara (mostrar)', tecla: 'B' },
  { t: 'ai-erase', icono: <Sparkles size={18} />, nombre: 'Borrar objeto con IA', tecla: 'J' },
  { t: 'segment', icono: <ScanEye size={18} />, nombre: 'Segmentar zona (clic o pincel)', tecla: 'S' },
  { t: 'eyedropper', icono: <Pipette size={18} />, nombre: 'Cuentagotas', tecla: 'I' },
];

const FORMAS = [
  { f: 'rect', i: <Square size={16} />, n: 'Rectángulo' },
  { f: 'ellipse', i: <Circle size={16} />, n: 'Círculo' },
  { f: 'arrow', i: <ArrowRight size={16} />, n: 'Flecha' },
  { f: 'band', i: <RectangleHorizontal size={16} />, n: 'Banda' },
  { f: 'badge', i: <Award size={16} />, n: 'Insignia' },
  { f: 'star', i: <Star size={16} />, n: 'Estrella' },
  { f: 'line', i: <Minus size={16} />, n: 'Línea' },
] as const;

export function BarraHerramientas() {
  const { herramienta, setHerramienta, formaActiva, set, pincel } = useEditor();
  const seg = useSegmento();
  return (
    <div className="flex h-full">
      <div className="flex w-11 flex-col items-center gap-1 border-r border-borde bg-panel py-2">
        {HERRAMIENTAS.map((h) => (
          <button
            key={h.t}
            type="button"
            data-testid={`herr-${h.t}`}
            title={`${h.nombre} (${h.tecla})`}
            aria-label={h.nombre}
            onClick={() => {
              setHerramienta(h.t);
              if (h.t !== 'segment') useSegmento.getState().limpiar();
            }}
            className={`rounded p-2 ${herramienta === h.t ? 'bg-acento text-white' : 'text-tenue hover:bg-panel2 hover:text-texto'}`}
          >
            {h.icono}
          </button>
        ))}
        <div className="my-1 h-px w-6 bg-borde" />
        <button type="button" title="Importar imagen propia" aria-label="Importar imagen" data-testid="importar-imagen" className="rounded p-2 text-tenue hover:bg-panel2 hover:text-texto" onClick={() => set({ dialogo: 'importar' })}>
          <ImageIcon size={18} />
        </button>
      </div>
      {/* opciones de la herramienta activa */}
      {(herramienta === 'shape' || herramienta.startsWith('mask') || herramienta === 'ai-erase' || herramienta === 'segment') && (
        <div className="w-44 space-y-2 border-r border-borde bg-panel p-2 text-xs">
          {herramienta === 'shape' && (
            <>
              <div className="text-tenue">Forma (arrastra en el lienzo)</div>
              <div className="grid grid-cols-4 gap-1">
                {FORMAS.map((f) => (
                  <button key={f.f} type="button" title={f.n} aria-label={f.n} onClick={() => set({ formaActiva: f.f })} className={`rounded p-2 ${formaActiva === f.f ? 'bg-acento text-white' : 'bg-panel2 hover:bg-borde'}`}>
                    {f.i}
                  </button>
                ))}
              </div>
            </>
          )}
          {(herramienta.startsWith('mask') || herramienta === 'ai-erase' || (herramienta === 'segment' && seg.modo === 'pincel')) && (
            <>
              <label className="block">
                <span className="text-tenue">Tamaño del pincel: {pincel.tam}px</span>
                <input type="range" min={4} max={400} value={pincel.tam} className="w-full accent-acento" onChange={(e) => set({ pincel: { ...pincel, tam: Number(e.target.value) } })} />
              </label>
              {herramienta.startsWith('mask') && (
                <label className="block">
                  <span className="text-tenue">Dureza: {Math.round(pincel.dureza * 100)}%</span>
                  <input type="range" min={0} max={0.98} step={0.02} value={pincel.dureza} className="w-full accent-acento" onChange={(e) => set({ pincel: { ...pincel, dureza: Number(e.target.value) } })} />
                </label>
              )}
            </>
          )}
          {herramienta.startsWith('mask') && <p className="text-xxs text-tenue">La máscara no destruye la imagen: con el pincel de mostrar recuperas lo ocultado. Teclas [ y ] cambian el tamaño.</p>}
          {herramienta === 'ai-erase' && <p className="text-xxs text-tenue">Pinta sobre lo que quieras borrar de la capa seleccionada (o del fondo). Se rellena con IA en tu equipo.</p>}
          {herramienta === 'segment' && <OpcionesSegmento />}
        </div>
      )}
    </div>
  );
}

function OpcionesSegmento() {
  const seg = useSegmento();
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['clic', 'pincel'] as const).map((m) => (
          <button key={m} type="button" onClick={() => seg.set({ modo: m, puntos: [], previa: null })} className={`flex-1 rounded px-2 py-1 ${seg.modo === m ? 'bg-acento text-white' : 'bg-panel2'}`}>
            {m === 'clic' ? 'Clics' : 'Pincel'}
          </button>
        ))}
      </div>
      <p className="text-xxs text-tenue">
        {seg.modo === 'clic' ? 'Clic: añadir zona. Alt+clic o clic derecho: quitar zona. ' : 'Pinta sobre el objeto a recortar. '}
        Se usa la capa seleccionada o la imagen original. Confirma en el panel derecho.
      </p>
    </div>
  );
}
