import { create } from 'zustand';
import { clonarCapa, docVacio, uid } from './defaults';
import type { Doc, Layer, Tool } from './types';

/** Historial ilimitado de instantáneas del documento (las capas sin cambios se comparten). */
interface Historial {
  pasado: Doc[];
  futuro: Doc[];
  ultimaClave: string | null;
  ultimaHora: number;
}

export interface Aviso {
  id: string;
  tipo: 'info' | 'ok' | 'aviso' | 'error';
  texto: string;
}

export interface EstadoEditor {
  doc: Doc;
  historial: Historial;
  seleccion: string[];
  herramienta: Tool;
  formaActiva: 'rect' | 'ellipse' | 'arrow' | 'band' | 'badge' | 'star' | 'line';
  pincel: { tam: number; dureza: number };
  zoom: number;
  pan: { x: number; y: number };
  verReglas: boolean;
  verCuadricula: boolean;
  ajustarCuadricula: boolean;
  tamCuadricula: number;
  ocupado: string | null;
  avisos: Aviso[];
  guardado: 'guardado' | 'pendiente' | 'guardando' | 'error';
  cuentagotas: ((color: string) => void) | null;
  dialogo: string | null;
  archivoPendiente: File | null;

  // documento
  cargarDoc: (d: Doc) => void;
  cambiar: (fn: (d: Doc) => Doc, clave?: string) => void;
  actualizarCapa: (id: string, cambios: Partial<Layer>, clave?: string) => void;
  actualizarCapas: (ids: string[], fn: (l: Layer) => Partial<Layer>, clave?: string) => void;
  /** Cambios que no son acciones del usuario (medidas calculadas): no entran en el historial. */
  fijarSinHistorial: (fn: (d: Doc) => Doc) => void;
  anadirCapa: (l: Layer, encimaDe?: string) => void;
  borrarSeleccion: () => void;
  duplicarSeleccion: () => void;
  moverCapa: (id: string, nuevoIndice: number) => void;
  subirBajar: (dir: 1 | -1 | 'arriba' | 'abajo') => void;
  agrupar: () => void;
  desagrupar: () => void;
  deshacer: () => void;
  rehacer: () => void;

  // interfaz
  seleccionar: (ids: string[], anadir?: boolean) => void;
  setHerramienta: (t: Tool) => void;
  set: (p: Partial<EstadoEditor>) => void;
  avisar: (texto: string, tipo?: Aviso['tipo']) => void;
  quitarAviso: (id: string) => void;
}

const VENTANA_FUSION_MS = 900;

export const useEditor = create<EstadoEditor>((set, get) => ({
  doc: docVacio(),
  historial: { pasado: [], futuro: [], ultimaClave: null, ultimaHora: 0 },
  seleccion: [],
  herramienta: 'select',
  formaActiva: 'rect',
  pincel: { tam: 40, dureza: 0.8 },
  zoom: 1,
  pan: { x: 0, y: 0 },
  verReglas: true,
  verCuadricula: false,
  ajustarCuadricula: false,
  tamCuadricula: 40,
  ocupado: null,
  avisos: [],
  guardado: 'guardado',
  cuentagotas: null,
  dialogo: null,
  archivoPendiente: null,

  cargarDoc: (d) =>
    set({ doc: d, historial: { pasado: [], futuro: [], ultimaClave: null, ultimaHora: 0 }, seleccion: [], guardado: 'guardado' }),

  cambiar: (fn, clave) => {
    const { doc, historial } = get();
    const nuevo = fn(doc);
    if (nuevo === doc) return;
    const ahora = Date.now();
    // los cambios continuos (deslizadores, escribir) con la misma clave se funden en un paso
    const fusionar = clave && historial.ultimaClave === clave && ahora - historial.ultimaHora < VENTANA_FUSION_MS;
    set({
      doc: nuevo,
      guardado: 'pendiente',
      historial: {
        pasado: fusionar ? historial.pasado : [...historial.pasado, doc],
        futuro: [],
        ultimaClave: clave ?? null,
        ultimaHora: ahora,
      },
    });
  },

  actualizarCapa: (id, cambios, clave) =>
    get().cambiar((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...cambios } as Layer) : l)) }), clave),

  actualizarCapas: (ids, fn, clave) =>
    get().cambiar((d) => ({ ...d, layers: d.layers.map((l) => (ids.includes(l.id) ? ({ ...l, ...fn(l) } as Layer) : l)) }), clave),

  fijarSinHistorial: (fn) => {
    const { doc, historial } = get();
    const nuevo = fn(doc);
    if (nuevo === doc) return;
    // también se aplica a la última instantánea para que deshacer no «desmida» las capas
    set({ doc: nuevo });
    void historial;
  },

  anadirCapa: (l, encimaDe) => {
    get().cambiar((d) => {
      const capas = [...d.layers];
      const i = encimaDe ? capas.findIndex((c) => c.id === encimaDe) : -1;
      // por defecto arriba del todo, pero siempre debajo de la referencia «Original»
      const iOrig = capas.findIndex((c) => c.role === 'original');
      const tope = iOrig >= 0 ? iOrig : capas.length;
      capas.splice(i >= 0 ? i + 1 : tope, 0, l);
      return { ...d, layers: capas };
    });
    set({ seleccion: [l.id] });
  },

  borrarSeleccion: () => {
    const { seleccion } = get();
    if (!seleccion.length) return;
    get().cambiar((d) => ({ ...d, layers: d.layers.filter((l) => !seleccion.includes(l.id) || l.locked) }));
    set({ seleccion: [] });
  },

  duplicarSeleccion: () => {
    const { seleccion, doc } = get();
    if (!seleccion.length) return;
    const nuevos: string[] = [];
    get().cambiar((d) => {
      const capas: Layer[] = [];
      for (const l of d.layers) {
        capas.push(l);
        if (seleccion.includes(l.id)) {
          const c = clonarCapa(l);
          c.x += 20;
          c.y += 20;
          c.locked = false;
          nuevos.push(c.id);
          capas.push(c);
        }
      }
      return { ...d, layers: capas };
    });
    void doc;
    set({ seleccion: nuevos });
  },

  moverCapa: (id, nuevoIndice) =>
    get().cambiar((d) => {
      const capas = [...d.layers];
      const i = capas.findIndex((l) => l.id === id);
      if (i < 0) return d;
      const [l] = capas.splice(i, 1);
      capas.splice(Math.max(0, Math.min(capas.length, nuevoIndice)), 0, l);
      return { ...d, layers: capas };
    }),

  subirBajar: (dir) => {
    const { seleccion } = get();
    if (!seleccion.length) return;
    get().cambiar((d) => {
      let capas = [...d.layers];
      const sel = capas.filter((l) => seleccion.includes(l.id));
      const resto = capas.filter((l) => !seleccion.includes(l.id));
      if (dir === 'arriba') return { ...d, layers: [...resto, ...sel] };
      if (dir === 'abajo') return { ...d, layers: [...sel, ...resto] };
      const orden = dir === 1 ? [...capas.keys()].reverse() : [...capas.keys()];
      for (const i of orden) {
        const j = i + dir;
        if (!seleccion.includes(capas[i].id) || j < 0 || j >= capas.length || seleccion.includes(capas[j].id)) continue;
        [capas[i], capas[j]] = [capas[j], capas[i]];
      }
      capas = [...capas];
      return { ...d, layers: capas };
    });
  },

  agrupar: () => {
    const { seleccion } = get();
    if (seleccion.length < 2) return;
    const gid = uid();
    get().cambiar((d) => {
      // las capas del grupo quedan juntas, en la posición de la más alta
      const sel = d.layers.filter((l) => seleccion.includes(l.id)).map((l) => ({ ...l, groupId: gid }));
      const ultima = Math.max(...d.layers.map((l, i) => (seleccion.includes(l.id) ? i : -1)));
      const capas: Layer[] = [];
      d.layers.forEach((l, i) => {
        if (!seleccion.includes(l.id)) capas.push(l);
        if (i === ultima) capas.push(...sel);
      });
      return { ...d, layers: capas, groups: [...d.groups, { id: gid, name: `Grupo ${d.groups.length + 1}` }] };
    });
  },

  desagrupar: () => {
    const { seleccion, doc } = get();
    const gids = new Set(doc.layers.filter((l) => seleccion.includes(l.id) && l.groupId).map((l) => l.groupId));
    if (!gids.size) return;
    get().cambiar((d) => ({
      ...d,
      layers: d.layers.map((l) => (gids.has(l.groupId ?? '') ? { ...l, groupId: null } : l)),
      groups: d.groups.filter((g) => !gids.has(g.id)),
    }));
  },

  deshacer: () => {
    const { historial, doc, seleccion } = get();
    const prev = historial.pasado[historial.pasado.length - 1];
    if (!prev) return;
    set({
      doc: prev,
      guardado: 'pendiente',
      seleccion: seleccion.filter((id) => prev.layers.some((l) => l.id === id)),
      historial: { pasado: historial.pasado.slice(0, -1), futuro: [doc, ...historial.futuro], ultimaClave: null, ultimaHora: 0 },
    });
  },

  rehacer: () => {
    const { historial, doc, seleccion } = get();
    const sig = historial.futuro[0];
    if (!sig) return;
    set({
      doc: sig,
      guardado: 'pendiente',
      seleccion: seleccion.filter((id) => sig.layers.some((l) => l.id === id)),
      historial: { pasado: [...historial.pasado, doc], futuro: historial.futuro.slice(1), ultimaClave: null, ultimaHora: 0 },
    });
  },

  seleccionar: (ids, anadir) => {
    const { seleccion, doc } = get();
    // seleccionar una capa de un grupo selecciona el grupo entero (salvo con Alt, gestionado fuera)
    let ampliados = ids;
    if (!anadir) {
      const gids = new Set(doc.layers.filter((l) => ids.includes(l.id) && l.groupId).map((l) => l.groupId));
      if (gids.size) ampliados = [...new Set([...ids, ...doc.layers.filter((l) => gids.has(l.groupId ?? '')).map((l) => l.id)])];
    }
    set({ seleccion: anadir ? [...new Set([...seleccion.filter((s) => !ids.includes(s)), ...ids.filter((i) => !seleccion.includes(i))])] : ampliados });
  },

  setHerramienta: (t) => set({ herramienta: t }),
  set: (p) => set(p),
  avisar: (texto, tipo = 'info') => {
    const id = uid();
    set({ avisos: [...get().avisos, { id, tipo, texto }] });
    setTimeout(() => get().quitarAviso(id), tipo === 'error' ? 9000 : 5000);
  },
  quitarAviso: (id) => set({ avisos: get().avisos.filter((a) => a.id !== id) }),
}));

export const capaPorId = (doc: Doc, id: string) => doc.layers.find((l) => l.id === id);
