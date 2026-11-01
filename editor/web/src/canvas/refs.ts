import Konva from 'konva';
import { create } from 'zustand';
import type { Doc, ImageLayer, Layer } from '../types';

/** Referencias compartidas al escenario de Konva (para exportar, unir capas, cuentagotas…). */
export const refs: { stage: Konva.Stage | null; contenido: Konva.Group | null; transformer: Konva.Transformer | null } = {
  stage: null,
  contenido: null,
  transformer: null,
};

/** Dibuja el documento (o solo algunas capas) a su tamaño real en un lienzo nuevo. */
export function renderizar(doc: Doc, opciones: { ids?: string[]; escala?: number; fondo?: boolean; recorte?: { x: number; y: number; w: number; h: number } } = {}): HTMLCanvasElement {
  const escala = opciones.escala ?? 1;
  const r = opciones.recorte ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const div = document.createElement('div');
  const st = new Konva.Stage({ container: div, width: Math.max(1, Math.round(r.w * escala)), height: Math.max(1, Math.round(r.h * escala)) });
  const capa = new Konva.Layer();
  st.add(capa);
  const g = new Konva.Group({ scaleX: escala, scaleY: escala, x: -r.x * escala, y: -r.y * escala });
  capa.add(g);
  if (opciones.fondo !== false && !opciones.ids) g.add(new Konva.Rect({ x: 0, y: 0, width: doc.width, height: doc.height, fill: doc.background }));
  const cont = refs.contenido;
  if (cont) {
    for (const hijo of cont.getChildren()) {
      if (!hijo.hasName('capa')) continue;
      if (opciones.ids && !opciones.ids.includes(hijo.id())) continue;
      if (!hijo.visible()) continue;
      g.add(hijo.clone({ draggable: false }));
    }
  }
  capa.draw();
  const c = capa.toCanvas({ x: 0, y: 0, width: st.width(), height: st.height(), pixelRatio: 1 });
  st.destroy();
  return c;
}

/** Caja que ocupan unas capas en coordenadas del documento. */
export function cajaDe(ids: string[]) {
  const cont = refs.contenido;
  if (!cont) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const n = cont.findOne('#' + id);
    if (!n || !n.visible()) continue;
    const r = n.getClientRect({ relativeTo: cont });
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
}

/** Transforma un punto del documento a píxeles de la imagen original de una capa de imagen. */
export function docANatural(capa: ImageLayer, natW: number, natH: number, p: { x: number; y: number }) {
  const t = new Konva.Transform();
  t.translate(capa.x, capa.y);
  t.rotate((capa.rotation * Math.PI) / 180);
  t.scale(capa.scaleX, capa.scaleY);
  const local = t.copy().invert().point(p);
  return { x: (local.x * natW) / capa.width, y: (local.y * natH) / capa.height };
}

/** Crea los parámetros de una capa a partir de un recorte (en píxeles naturales) de otra capa de imagen. */
export function capaDesdeRecorte(origen: ImageLayer, natW: number, natH: number, rec: { x: number; y: number; width: number; height: number }) {
  const kx = origen.width / natW;
  const ky = origen.height / natH;
  const t = new Konva.Transform();
  t.translate(origen.x, origen.y);
  t.rotate((origen.rotation * Math.PI) / 180);
  t.scale(origen.scaleX, origen.scaleY);
  const p = t.point({ x: rec.x * kx, y: rec.y * ky });
  return { x: p.x, y: p.y, width: rec.width * kx, height: rec.height * ky, rotation: origen.rotation, scaleX: origen.scaleX, scaleY: origen.scaleY };
}

export const esImagen = (l?: Layer): l is ImageLayer => !!l && l.type === 'image';

/** Estado temporal de la herramienta de segmentar (clics y vista previa). */
export interface EstadoSegmento {
  modo: 'clic' | 'pincel';
  origenId: string | null;
  puntos: { x: number; y: number; positivo: boolean }[]; // en píxeles naturales del origen
  previa: { src: string; x: number; y: number; width: number; height: number; confidence: number } | null;
  cargando: boolean;
}

export const useSegmento = create<EstadoSegmento & { set: (p: Partial<EstadoSegmento>) => void; limpiar: () => void }>((set) => ({
  modo: 'clic',
  origenId: null,
  puntos: [],
  previa: null,
  cargando: false,
  set: (p) => set(p),
  limpiar: () => set({ puntos: [], previa: null, cargando: false }),
}));
