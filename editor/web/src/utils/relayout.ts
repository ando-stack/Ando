import type { Doc, Layer, TextLayer } from '../types';

/** Caja (sin girar) de una capa en coordenadas del lienzo. */
export function caja(l: Layer) {
  const w = Math.abs(l.width * l.scaleX);
  const h = Math.abs(l.height * l.scaleY);
  return { x: l.x, y: l.y, w, h };
}

const esFondo = (l: Layer, d: Doc) =>
  l.role === 'fondo' || l.role === 'original' || (l.type === 'image' && caja(l).w >= d.width * 0.95 && caja(l).h >= d.height * 0.95);

/**
 * Recolocación inteligente al cambiar el tamaño del lienzo (punto de partida editable):
 *  - fondos y capas que cubren todo el lienzo → cubren el nuevo lienzo (recorte centrado);
 *  - el resto se escala de forma uniforme (encaje) y conserva su posición relativa respecto
 *    al centro y a los bordes a los que estaba anclado; nada queda fuera del lienzo si antes
 *    estaba dentro.
 */
export function recolocar(doc: Doc, ancho: number, alto: number): Doc {
  const sx = ancho / doc.width;
  const sy = alto / doc.height;
  const s = Math.min(sx, sy); // escala de encaje para elementos
  const margen = 0.03 * Math.min(ancho, alto);
  const layers = doc.layers.map((l): Layer => {
    if (esFondo(l, doc)) {
      const c = Math.max(ancho / caja(l).w, alto / caja(l).h);
      const w = caja(l).w * c;
      const h = caja(l).h * c;
      return { ...l, x: (ancho - w) / 2, y: (alto - h) / 2, scaleX: l.scaleX * c, scaleY: l.scaleY * c };
    }
    const b = caja(l);
    // anclaje: el lado más cercano de cada eje (izquierda/centro/derecha)
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const ax = anclaje(b.x, b.x + b.w, doc.width);
    const ay = anclaje(b.y, b.y + b.h, doc.height);
    const nw = b.w * s;
    const nh = b.h * s;
    let nx: number;
    let ny: number;
    if (ax === 'ini') nx = b.x * s;
    else if (ax === 'fin') nx = ancho - (doc.width - (b.x + b.w)) * s - nw;
    else nx = (cx / doc.width) * ancho - nw / 2;
    if (ay === 'ini') ny = b.y * s;
    else if (ay === 'fin') ny = alto - (doc.height - (b.y + b.h)) * s - nh;
    else ny = (cy / doc.height) * alto - nh / 2;
    const estabaDentro = b.x >= -1 && b.y >= -1 && b.x + b.w <= doc.width + 1 && b.y + b.h <= doc.height + 1;
    if (estabaDentro) {
      nx = Math.min(Math.max(nx, Math.min(margen, b.x * s)), ancho - nw - Math.min(margen, (doc.width - b.x - b.w) * s));
      ny = Math.min(Math.max(ny, Math.min(margen, b.y * s)), alto - nh - Math.min(margen, (doc.height - b.y - b.h) * s));
    }
    // la posición de la capa es su esquina (con giro): se desplaza la diferencia de la caja
    const base = { ...l, x: l.x + (nx - b.x) + (l.x - b.x) * (s - 1), y: l.y + (ny - b.y) + (l.y - b.y) * (s - 1) };
    if (l.type === 'text') {
      const t = base as TextLayer;
      return {
        ...t,
        fontSize: t.fontSize * s,
        letterSpacing: t.letterSpacing * s,
        strokes: t.strokes.map((k) => ({ ...k, width: k.width * s })),
        shadow: { ...t.shadow, blur: t.shadow.blur * s, offsetX: t.shadow.offsetX * s, offsetY: t.shadow.offsetY * s },
        glow: { ...t.glow, blur: t.glow.blur * s },
        extrude: { ...t.extrude, depth: t.extrude.depth * s },
        width: t.width * s,
        height: t.height * s,
        inkBox: undefined,
        needsFit: false,
      };
    }
    return { ...base, scaleX: l.scaleX * s, scaleY: l.scaleY * s };
  });
  return {
    ...doc,
    width: ancho,
    height: alto,
    layers,
    guides: { x: doc.guides.x.map((g) => g * sx), y: doc.guides.y.map((g) => g * sy) },
  };
}

function anclaje(a: number, b: number, total: number): 'ini' | 'centro' | 'fin' {
  const izq = a;
  const der = total - b;
  const centro = Math.abs((a + b) / 2 - total / 2);
  const m = Math.min(izq, der, centro);
  if (m === centro) return 'centro';
  return m === izq ? 'ini' : 'fin';
}
