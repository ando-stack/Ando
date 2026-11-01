import type { Adjustments, Doc, Fill, ImageEffects, ImageLayer, Layer, Shadow, ShapeLayer, ShapeType, TextLayer } from './types';

export const uid = () => Math.random().toString(16).slice(2, 12);

export const sombraVacia = (): Shadow => ({ enabled: false, color: '#000000', blur: 12, offsetX: 6, offsetY: 6, opacity: 0.6 });
export const relleno = (color: string): Fill => ({ type: 'solid', color, gradient: { colors: [color, '#000000'], angle: 90 } });
export const ajustesVacios = (): Adjustments => ({ brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpen: 0, blur: 0, filter: 'none' });
export const efectosVacios = (): ImageEffects => ({
  outline: { enabled: false, color: '#ffffff', width: 12 },
  glow: { enabled: false, color: '#ffffff', blur: 25, strength: 0.8 },
  shadow: { enabled: false, color: '#000000', blur: 20, offsetX: 8, offsetY: 8, opacity: 0.6 },
});

const base = (nombre: string, x: number, y: number, w: number, h: number) => ({
  id: uid(),
  name: nombre,
  x,
  y,
  width: w,
  height: h,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
  blendMode: 'source-over' as const,
  visible: true,
  locked: false,
  groupId: null,
  confidence: null,
  warnings: [],
});

export function nuevaImagen(src: string, x: number, y: number, w: number, h: number, nombre = 'Imagen', rol = 'usuario'): ImageLayer {
  return { ...base(nombre, x, y, w, h), type: 'image', role: rol, src, maskSrc: null, adjustments: ajustesVacios(), effects: efectosVacios() };
}

export function nuevoTexto(x: number, y: number, texto = 'TEXTO', tam = 120): TextLayer {
  return {
    ...base(`Texto: ${texto}`, x, y, 0, 0),
    type: 'text',
    role: 'usuario',
    text: texto,
    fontFamily: 'Anton',
    fontWeight: 400,
    fontSize: tam,
    letterSpacing: 0,
    lineHeight: 1.05,
    align: 'left',
    fill: relleno('#ffffff'),
    strokes: [],
    shadow: sombraVacia(),
    glow: { enabled: false, color: '#ffffff', blur: 20, strength: 0.8 },
    extrude: { enabled: false, depth: 10, color: '#000000', angle: 45 },
    skewX: 0,
    curve: 0,
  };
}

export const NOMBRES_FORMA: Record<ShapeType, string> = {
  rect: 'Rectángulo',
  ellipse: 'Círculo',
  arrow: 'Flecha',
  band: 'Banda',
  badge: 'Insignia',
  star: 'Estrella',
  line: 'Línea',
};

export function nuevaForma(tipo: ShapeType, x: number, y: number, w: number, h: number, color = '#e3122c'): ShapeLayer {
  return {
    ...base(NOMBRES_FORMA[tipo], x, y, w, h),
    type: 'shape',
    role: 'usuario',
    shapeType: tipo,
    fill: relleno(color),
    stroke: { color: '#ffffff', width: 0 },
    cornerRadius: tipo === 'rect' ? 0 : 0,
    points: tipo === 'badge' ? 16 : 5,
    shadow: sombraVacia(),
  };
}

export function docVacio(w = 1280, h = 720, nombre = 'Sin título'): Doc {
  return {
    id: '',
    name: nombre,
    width: w,
    height: h,
    background: '#1f2937',
    layers: [],
    groups: [],
    palette: [],
    guides: { x: [], y: [] },
    customFonts: [],
    version: 1,
  };
}

/** Completa un proyecto llegado del motor o de una versión anterior con los campos que falten. */
export function normalizarDoc(d: Partial<Doc> & { id?: string }): Doc {
  const v = docVacio(d.width ?? 1280, d.height ?? 720, d.name ?? 'Sin título');
  const doc: Doc = { ...v, ...d, id: d.id ?? '', guides: d.guides ?? v.guides, groups: d.groups ?? [], customFonts: d.customFonts ?? [], palette: d.palette ?? [], layers: [] };
  doc.layers = (d.layers ?? []).map((l) => normalizarCapa(l as Layer));
  return doc;
}

export function normalizarCapa(l: Layer): Layer {
  const b = { ...base(l.name ?? 'Capa', 0, 0, 0, 0), ...l } as Layer;
  if (b.type === 'image') {
    return { ...b, adjustments: { ...ajustesVacios(), ...b.adjustments }, effects: { ...efectosVacios(), ...b.effects }, maskSrc: b.maskSrc ?? null };
  }
  if (b.type === 'text') {
    const t = nuevoTexto(0, 0);
    return { ...t, ...b, fill: { ...t.fill, ...b.fill }, shadow: { ...t.shadow, ...b.shadow }, glow: { ...t.glow, ...b.glow }, extrude: { ...t.extrude, ...b.extrude }, strokes: b.strokes ?? [] } as TextLayer;
  }
  return b;
}

export function clonarCapa<T extends Layer>(l: T): T {
  return { ...structuredClone(l), id: uid(), name: `${l.name} (copia)` };
}

export const esFondoCompleto = (l: Layer, doc: Doc) =>
  l.type === 'image' && Math.abs(l.width * l.scaleX - doc.width) < 2 && Math.abs(l.height * l.scaleY - doc.height) < 2 && Math.abs(l.x) < 2 && Math.abs(l.y) < 2;
