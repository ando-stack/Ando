import { Cloud, Download, FolderOpen, Grid3x3, Keyboard, Magnet, Maximize, Redo2, Ruler, Smartphone, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { unirSeleccion, voltear } from './acciones';
import { api, type EstadoMotor } from './api';
import { Lienzo } from './canvas/Lienzo';
import { useSegmento } from './canvas/refs';
import { cargarBiblioteca } from './fonts';
import { formatoPorId } from './formats';
import { abrirProyecto, activarAutoguardado, guardarAhora, ultimoProyecto } from './proyecto';
import { useEditor } from './store';
import type { Tool } from './types';
import { Boton } from './ui/controles';
import { DialogoAtajos, DialogoDescomponer, DialogoExportar, DialogoFormatos, DialogoImportar, DialogoInicio, DialogoNube, DialogoPrevia, PanelEfectos } from './ui/Dialogos';
import { BarraHerramientas } from './ui/Herramientas';
import { PanelCapas } from './ui/PanelCapas';
import { PanelPropiedades } from './ui/PanelPropiedades';

const TECLAS: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', u: 'shape', e: 'mask-hide', b: 'mask-show', j: 'ai-erase', s: 'segment', i: 'eyedropper' };

export default function App() {
  const e = useEditor();
  const [motor, setMotor] = useState<EstadoMotor | null>(null);
  const [errorMotor, setErrorMotor] = useState<string | null>(null);
  const [pestana, setPestana] = useState<'props' | 'efectos'>('props');

  // arranque: estado del motor, fuentes y último proyecto
  useEffect(() => {
    api
      .estado()
      .then(setMotor)
      .catch((err) => setErrorMotor((err as Error).message));
    void cargarBiblioteca().catch(() => undefined);
    const id = ultimoProyecto();
    if (id) abrirProyecto(id).catch(() => useEditor.getState().set({ dialogo: 'inicio' }));
    else useEditor.getState().set({ dialogo: 'inicio' });
    const quitar = activarAutoguardado();
    const antesDeSalir = (ev: BeforeUnloadEvent) => {
      if (useEditor.getState().guardado === 'pendiente') {
        void guardarAhora();
        ev.preventDefault();
      }
    };
    window.addEventListener('beforeunload', antesDeSalir);
    return () => {
      quitar();
      window.removeEventListener('beforeunload', antesDeSalir);
    };
  }, []);

  // atajos de teclado
  useEffect(() => {
    const f = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      const s = useEditor.getState();
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (mod && k === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) s.rehacer();
        else s.deshacer();
      } else if (mod && k === 'y') {
        ev.preventDefault();
        s.rehacer();
      } else if (mod && k === 'd') {
        ev.preventDefault();
        s.duplicarSeleccion();
      } else if (mod && k === 'g') {
        ev.preventDefault();
        if (ev.shiftKey) s.desagrupar();
        else s.agrupar();
      } else if (mod && k === 'e') {
        ev.preventDefault();
        if (ev.shiftKey) s.set({ dialogo: 'exportar' });
        else void unirSeleccion();
      } else if (mod && k === 's') {
        ev.preventDefault();
        void guardarAhora().then(() => s.avisar('Proyecto guardado.', 'ok'));
      } else if (mod && k === 'a') {
        ev.preventDefault();
        s.seleccionar(s.doc.layers.filter((l) => !l.locked && l.visible).map((l) => l.id));
      } else if (mod && (ev.key === ']' || ev.key === '}')) {
        ev.preventDefault();
        s.subirBajar(ev.shiftKey ? 'arriba' : 1);
      } else if (mod && (ev.key === '[' || ev.key === '{')) {
        ev.preventDefault();
        s.subirBajar(ev.shiftKey ? 'abajo' : -1);
      } else if (mod && k === '0') {
        ev.preventDefault();
        window.dispatchEvent(new Event('estudio:encuadrar'));
      } else if (mod && k === '1') {
        ev.preventDefault();
        s.set({ zoom: 1 });
      } else if (mod && ev.key === "'") {
        ev.preventDefault();
        s.set({ verCuadricula: !s.verCuadricula });
      } else if (mod && k === 'r') {
        ev.preventDefault();
        s.set({ verReglas: !s.verReglas });
      } else if (!mod && (ev.key === 'Delete' || ev.key === 'Backspace')) {
        s.borrarSeleccion();
      } else if (ev.key === 'Escape') {
        s.seleccionar([]);
        useSegmento.getState().limpiar();
        s.set({ dialogo: s.doc.id ? null : s.dialogo });
      } else if (ev.key.startsWith('Arrow') && s.seleccion.length) {
        ev.preventDefault();
        const d = ev.shiftKey ? 10 : 1;
        const dx = ev.key === 'ArrowLeft' ? -d : ev.key === 'ArrowRight' ? d : 0;
        const dy = ev.key === 'ArrowUp' ? -d : ev.key === 'ArrowDown' ? d : 0;
        s.actualizarCapas(s.seleccion.filter((id) => !s.doc.layers.find((l) => l.id === id)?.locked), (l) => ({ x: l.x + dx, y: l.y + dy }), 'flechas');
      } else if (ev.shiftKey && k === 'h' && !mod) {
        voltear('h');
      } else if (ev.shiftKey && k === 'v' && !mod) {
        voltear('v');
      } else if (ev.key === '[') {
        s.set({ pincel: { ...s.pincel, tam: Math.max(4, s.pincel.tam - 8) } });
      } else if (ev.key === ']') {
        s.set({ pincel: { ...s.pincel, tam: Math.min(400, s.pincel.tam + 8) } });
      } else if (ev.key === '+' || ev.key === '=') {
        s.set({ zoom: Math.min(16, s.zoom * 1.2) });
      } else if (ev.key === '-') {
        s.set({ zoom: Math.max(0.03, s.zoom / 1.2) });
      } else if (ev.key === '?') {
        s.set({ dialogo: 'atajos' });
      } else if (!mod && !ev.altKey && TECLAS[k]) {
        s.setHerramienta(TECLAS[k]);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const fmt = formatoPorId(e.doc.formatId);
  const estadoGuardado = { guardado: 'Guardado', pendiente: 'Cambios sin guardar', guardando: 'Guardando…', error: 'Error al guardar' }[e.guardado];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-fondo text-texto">
      {/* barra superior */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-borde bg-panel px-2">
        <div className="mr-2 flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-gradient-to-br from-acento to-aviso" />
          <span className="text-sm font-semibold">Estudio de Capas</span>
        </div>
        <Boton titulo="Proyectos: abrir, nuevo o subir imagen" onClick={() => e.set({ dialogo: 'inicio' })} testid="boton-proyectos"><FolderOpen size={14} /> Proyectos</Boton>
        <span className="mx-1 h-5 w-px bg-borde" />
        <Boton titulo="Deshacer (Ctrl+Z)" deshabilitado={!e.historial.pasado.length} onClick={e.deshacer} testid="deshacer"><Undo2 size={14} /></Boton>
        <Boton titulo="Rehacer (Ctrl+Shift+Z)" deshabilitado={!e.historial.futuro.length} onClick={e.rehacer} testid="rehacer"><Redo2 size={14} /></Boton>
        <span className="mx-1 h-5 w-px bg-borde" />
        <Boton titulo="Alejar" onClick={() => e.set({ zoom: Math.max(0.03, e.zoom / 1.2) })}><ZoomOut size={14} /></Boton>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(e.zoom * 100)}%</span>
        <Boton titulo="Acercar" onClick={() => e.set({ zoom: Math.min(16, e.zoom * 1.2) })}><ZoomIn size={14} /></Boton>
        <Boton titulo="Encajar (Ctrl+0)" onClick={() => window.dispatchEvent(new Event('estudio:encuadrar'))}><Maximize size={14} /></Boton>
        <span className="mx-1 h-5 w-px bg-borde" />
        <Boton titulo="Reglas (Ctrl+R)" activo={e.verReglas} onClick={() => e.set({ verReglas: !e.verReglas })}><Ruler size={14} /></Boton>
        <Boton titulo="Cuadrícula (Ctrl+')" activo={e.verCuadricula} onClick={() => e.set({ verCuadricula: !e.verCuadricula })}><Grid3x3 size={14} /></Boton>
        <Boton titulo="Ajustar a la cuadrícula" activo={e.ajustarCuadricula} onClick={() => e.set({ ajustarCuadricula: !e.ajustarCuadricula, verCuadricula: !e.ajustarCuadricula || e.verCuadricula })}><Magnet size={14} /></Boton>
        <div className="flex-1" />
        <span className={`mr-2 text-xxs ${e.guardado === 'error' ? 'text-peligro' : 'text-tenue'}`} data-testid="estado-guardado">{estadoGuardado}</span>
        <Boton titulo="Cambiar formato del lienzo" onClick={() => e.set({ dialogo: 'formatos' })} testid="boton-formato">{fmt ? fmt.nombre : `${e.doc.width}×${e.doc.height}`}</Boton>
        <Boton titulo="Vista previa en el móvil" onClick={() => e.set({ dialogo: 'previa' })}><Smartphone size={14} /></Boton>
        <Boton titulo="Opciones en la nube (desactivadas por defecto)" onClick={() => e.set({ dialogo: 'nube' })}><Cloud size={14} /></Boton>
        <Boton titulo="Atajos de teclado (?)" onClick={() => e.set({ dialogo: 'atajos' })}><Keyboard size={14} /></Boton>
        <Boton tipo="primario" titulo="Exportar (Ctrl+Shift+E)" onClick={() => e.set({ dialogo: 'exportar' })} testid="boton-exportar"><Download size={14} /> Exportar</Boton>
      </header>

      {errorMotor && (
        <div className="bg-peligro/20 px-3 py-1 text-xs text-peligro">
          {errorMotor} — Arranca el motor con <code>scripts/iniciar.sh</code> (o <code>iniciar.bat</code> en Windows).
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <BarraHerramientas />
        <main className="min-w-0 flex-1">
          <Lienzo />
        </main>
        <aside className="flex w-80 shrink-0 flex-col border-l border-borde bg-panel">
          <div className="flex border-b border-borde text-xs">
            {(['props', 'efectos'] as const).map((p) => (
              <button key={p} type="button" className={`flex-1 py-2 ${pestana === p ? 'border-b-2 border-acento text-texto' : 'text-tenue'}`} onClick={() => setPestana(p)}>
                {p === 'props' ? 'Propiedades' : 'Efectos y texturas'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-[3]">{pestana === 'props' ? <PanelPropiedades /> : <div className="h-full overflow-y-auto"><PanelEfectos /></div>}</div>
          <div className="min-h-0 flex-[2] border-t border-borde">
            <PanelCapas />
          </div>
        </aside>
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-borde bg-panel px-3 text-xxs text-tenue">
        <span>
          Motor local: {motor ? `${motor.dispositivo.nombre} (${motor.dispositivo.dispositivo.toUpperCase()})` : errorMotor ? 'no disponible' : 'conectando…'}
        </span>
        {motor && <span>Modelos: {motor.modelos.filter((m) => m.disponible).length}/{motor.modelos.filter((m) => !m.opcional).length}</span>}
        <span>Nube: {motor?.nube.activada ? 'ACTIVADA' : 'desactivada'}</span>
        <span className="ml-auto">Las imágenes se procesan en tu equipo.</span>
      </footer>

      {/* avisos */}
      <div className="pointer-events-none fixed bottom-8 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {e.avisos.map((a) => (
          <div
            key={a.id}
            role="status"
            className={`pointer-events-auto max-w-lg rounded px-3 py-2 text-xs shadow-lg ${a.tipo === 'error' ? 'bg-peligro text-white' : a.tipo === 'aviso' ? 'bg-aviso text-black' : a.tipo === 'ok' ? 'bg-ok text-black' : 'bg-panel2 text-texto'}`}
            onClick={() => e.quitarAviso(a.id)}
          >
            {a.texto}
          </div>
        ))}
      </div>

      {e.ocupado && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40" data-testid="ocupado">
          <div className="flex items-center gap-3 rounded bg-panel px-4 py-3 text-sm shadow-xl">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-acento border-t-transparent" />
            {e.ocupado}
          </div>
        </div>
      )}

      {e.dialogo === 'inicio' && <DialogoInicio />}
      {e.dialogo === 'descomponer' && <DialogoDescomponer />}
      {e.dialogo === 'importar' && <DialogoImportar />}
      {e.dialogo === 'formatos' && <DialogoFormatos />}
      {e.dialogo === 'exportar' && <DialogoExportar />}
      {e.dialogo === 'previa' && <DialogoPrevia />}
      {e.dialogo === 'nube' && <DialogoNube />}
      {e.dialogo === 'atajos' && <DialogoAtajos />}
    </div>
  );
}
