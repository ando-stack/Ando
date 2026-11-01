import { api } from './api';
import { cajaDe, renderizar } from './canvas/refs';
import { cargarImagen } from './canvas/componer';
import { nuevaImagen, relleno, sombraVacia, uid } from './defaults';
import { asegurarFuente } from './fonts';
import { useEditor } from './store';
import type { ImageLayer, Layer, TextLayer } from './types';

const st = () => useEditor.getState();

async function conOcupado<T>(msg: string, fn: () => Promise<T>): Promise<T | undefined> {
  st().set({ ocupado: msg });
  try {
    return await fn();
  } catch (e) {
    st().avisar((e as Error).message, 'error');
    return undefined;
  } finally {
    st().set({ ocupado: null });
  }
}

const aBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo crear la imagen.'))), 'image/png'));

/** Une las capas seleccionadas en una sola capa de imagen (o rasteriza una capa). */
export async function unirSeleccion(rasterizarSolo = false) {
  const { seleccion, doc } = st();
  const ids = doc.layers.filter((l) => seleccion.includes(l.id) && l.visible).map((l) => l.id);
  if (!ids.length || (!rasterizarSolo && ids.length < 2)) {
    st().avisar(rasterizarSolo ? 'Selecciona una capa visible.' : 'Selecciona al menos dos capas visibles para unirlas.', 'aviso');
    return;
  }
  const caja = cajaDe(ids);
  if (!caja || caja.w < 1 || caja.h < 1) return;
  await conOcupado(rasterizarSolo ? 'Rasterizando…' : 'Uniendo capas…', async () => {
    const c = renderizar(doc, { ids, recorte: caja });
    const r = await api.subirRecurso(doc.id, await aBlob(c));
    const primera = doc.layers.find((l) => l.id === ids[ids.length - 1])!;
    const nueva = nuevaImagen(r.url, caja.x, caja.y, caja.w, caja.h, rasterizarSolo ? `${primera.name} (imagen)` : 'Capas unidas', primera.role === 'texto' ? 'texto-imagen' : (primera.role as string) ?? 'usuario');
    st().cambiar((d) => {
      const idx = Math.max(...d.layers.map((l, i) => (ids.includes(l.id) ? i : -1)));
      const capas: Layer[] = [];
      d.layers.forEach((l, i) => {
        if (!ids.includes(l.id)) capas.push(l);
        if (i === idx) capas.push(nueva);
      });
      return { ...d, layers: capas };
    });
    st().set({ seleccion: [nueva.id] });
  });
}

/** Divide una capa de imagen en sus partes separadas (lo hace el motor). */
export async function dividirSeleccion() {
  const { seleccion, doc } = st();
  const capa = doc.layers.find((l) => l.id === seleccion[0]);
  if (seleccion.length !== 1 || capa?.type !== 'image') {
    st().avisar('Selecciona una sola capa de imagen para dividirla.', 'aviso');
    return;
  }
  await conOcupado('Dividiendo la capa…', async () => {
    const im = await cargarImagen(capa.src);
    const r = await api.dividir(doc.id, capa.src);
    const kx = capa.width / im.width;
    const ky = capa.height / im.height;
    const cos = Math.cos((capa.rotation * Math.PI) / 180);
    const sin = Math.sin((capa.rotation * Math.PI) / 180);
    const partes: ImageLayer[] = r.partes.map((p, i) => {
      const lx = p.x * kx * capa.scaleX;
      const ly = p.y * ky * capa.scaleY;
      return {
        ...structuredClone(capa),
        id: uid(),
        name: `${capa.name} · parte ${i + 1}`,
        src: p.url,
        maskSrc: null,
        x: capa.x + lx * cos - ly * sin,
        y: capa.y + lx * sin + ly * cos,
        width: p.width * kx,
        height: p.height * ky,
      };
    });
    st().cambiar((d) => {
      const capas: Layer[] = [];
      for (const l of d.layers) {
        if (l.id === capa.id) capas.push(...partes);
        else capas.push(l);
      }
      return { ...d, layers: capas };
    });
    st().set({ seleccion: partes.map((p) => p.id) });
    st().avisar(`Capa dividida en ${partes.length} partes.`, 'ok');
  });
}

/** Importa una imagen propia como capa; opcionalmente le quita el fondo con IA (en local). */
export async function importarImagen(archivo: File, quitarFondo: boolean) {
  const { doc } = st();
  if (!/^image\/(png|jpe?g|webp)$/.test(archivo.type)) {
    st().avisar('Formato no admitido: usa JPG, PNG o WebP.', 'error');
    return;
  }
  await conOcupado(quitarFondo ? 'Quitando el fondo con IA (en tu equipo)…' : 'Importando imagen…', async () => {
    const r = await api.subirRecurso(doc.id, archivo, archivo.name);
    let url = r.url;
    let w = r.width;
    let h = r.height;
    if (quitarFondo) {
      const q = await api.quitarFondo(doc.id, r.url);
      url = q.url;
      w = q.width;
      h = q.height;
      q.avisos?.forEach((a) => st().avisar(a, 'aviso'));
    }
    const esc = Math.min(1, (doc.width * 0.6) / w, (doc.height * 0.8) / h);
    const capa = nuevaImagen(url, (doc.width - w * esc) / 2, (doc.height - h * esc) / 2, w * esc, h * esc, archivo.name.replace(/\.[^.]+$/, '').slice(0, 30), 'usuario');
    st().anadirCapa(capa);
  });
}

/** Sustituye la imagen de una capa por otra (manteniendo posición y tamaño). */
export async function reemplazarImagen(capa: ImageLayer, archivo: File, quitarFondo: boolean) {
  const { doc } = st();
  await conOcupado('Reemplazando imagen…', async () => {
    const r = await api.subirRecurso(doc.id, archivo, archivo.name);
    let url = r.url;
    let w = r.width;
    let h = r.height;
    if (quitarFondo) {
      const q = await api.quitarFondo(doc.id, r.url);
      url = q.url;
      w = q.width;
      h = q.height;
    }
    // encaja la nueva imagen en la caja de la anterior (sin deformar)
    const esc = Math.min(capa.width / w, capa.height / h);
    st().actualizarCapa(capa.id, { src: url, maskSrc: null, width: w * esc, height: h * esc, x: capa.x + (capa.width - w * esc) / 2, y: capa.y + (capa.height - h * esc) / 2 } as Partial<ImageLayer>);
  });
}

export function voltear(eje: 'h' | 'v') {
  const { seleccion, doc } = st();
  const ids = seleccion.filter((id) => !doc.layers.find((l) => l.id === id)?.locked);
  if (!ids.length) return;
  st().actualizarCapas(ids, (l) => {
    // voltea respecto al centro de la capa
    const w = l.width * l.scaleX;
    const h = l.height * l.scaleY;
    const a = (l.rotation * Math.PI) / 180;
    if (eje === 'h') return { scaleX: -l.scaleX, x: l.x + w * Math.cos(a), y: l.y + w * Math.sin(a) };
    return { scaleY: -l.scaleY, x: l.x - h * Math.sin(a), y: l.y + h * Math.cos(a) };
  });
}

export function alinear(como: 'izq' | 'centroH' | 'der' | 'arriba' | 'centroV' | 'abajo') {
  const { seleccion, doc } = st();
  const ids = seleccion.filter((id) => !doc.layers.find((l) => l.id === id)?.locked);
  if (!ids.length) return;
  const cambios = new Map<string, { x: number; y: number }>();
  const ref = ids.length > 1 ? cajaDe(ids) : { x: 0, y: 0, w: doc.width, h: doc.height };
  if (!ref) return;
  for (const id of ids) {
    const c = cajaDe([id]);
    const l = doc.layers.find((x) => x.id === id);
    if (!c || !l) continue;
    let dx = 0;
    let dy = 0;
    if (como === 'izq') dx = ref.x - c.x;
    if (como === 'der') dx = ref.x + ref.w - (c.x + c.w);
    if (como === 'centroH') dx = ref.x + ref.w / 2 - (c.x + c.w / 2);
    if (como === 'arriba') dy = ref.y - c.y;
    if (como === 'abajo') dy = ref.y + ref.h - (c.y + c.h);
    if (como === 'centroV') dy = ref.y + ref.h / 2 - (c.y + c.h / 2);
    cambios.set(id, { x: l.x + dx, y: l.y + dy });
  }
  st().actualizarCapas([...cambios.keys()], (l) => cambios.get(l.id) ?? {});
}

/** Muestra el texto editable aproximado y oculta la imagen recortada del texto. */
export function recrearComoTexto(img: ImageLayer) {
  if (!img.linkedTextId) return;
  st().cambiar((d) => ({
    ...d,
    layers: d.layers.map((l) => (l.id === img.id ? { ...l, visible: false } : l.id === img.linkedTextId ? { ...l, visible: true, warnings: [] } : l)),
  }));
  st().set({ seleccion: [img.linkedTextId] });
}

// ------------------------------------------------------------------ estilos de texto predefinidos

export interface EstiloTexto {
  nombre: string;
  aplicar: Partial<TextLayer>;
}

const sombra = (color: string, x: number, y: number, blur = 0, opacity = 1) => ({ enabled: true, color, offsetX: x, offsetY: y, blur, opacity });
const sinSombra = sombraVacia();
const sinGlow = { enabled: false, color: '#ffffff', blur: 20, strength: 0.8 };
const sinExtr = { enabled: false, depth: 10, color: '#000000', angle: 45 };

export const ESTILOS_TEXTO: EstiloTexto[] = [
  { nombre: 'Impacto amarillo', aplicar: { fontFamily: 'Anton', fontWeight: 400, fill: relleno('#ffe600'), strokes: [{ color: '#000000', width: 10 }], shadow: sombra('#000000', 8, 8), glow: sinGlow, extrude: sinExtr, uppercase: true } },
  { nombre: 'Blanco y rojo', aplicar: { fontFamily: 'Bangers', fontWeight: 400, fill: relleno('#ffffff'), strokes: [{ color: '#e3122c', width: 8 }], shadow: sinSombra, glow: sinGlow, extrude: sinExtr, uppercase: true } },
  { nombre: 'Doble contorno', aplicar: { fontFamily: 'Bowlby One', fontWeight: 400, fill: relleno('#ffe600'), strokes: [{ color: '#000000', width: 8 }, { color: '#ffffff', width: 8 }], shadow: sinSombra, glow: sinGlow, extrude: sinExtr } },
  { nombre: 'Neón', aplicar: { fontFamily: 'Righteous', fontWeight: 400, fill: relleno('#ffffff'), strokes: [{ color: '#00e5ff', width: 3 }], shadow: sinSombra, glow: { enabled: true, color: '#00e5ff', blur: 35, strength: 1.4 }, extrude: sinExtr } },
  { nombre: 'Fuego', aplicar: { fontFamily: 'Alfa Slab One', fontWeight: 400, fill: { type: 'linear', color: '#ffb000', gradient: { colors: ['#ffe14d', '#ff7a00', '#e3122c'], angle: 90 } }, strokes: [{ color: '#ffffff', width: 6 }], shadow: sombra('#000000', 0, 8, 16, 0.6), glow: sinGlow, extrude: sinExtr } },
  { nombre: '3D deportivo', aplicar: { fontFamily: 'Russo One', fontWeight: 400, fill: relleno('#ffffff'), strokes: [{ color: '#0b1d51', width: 5 }], shadow: sinSombra, glow: sinGlow, extrude: { enabled: true, depth: 14, color: '#0b1d51', angle: 50 }, skewX: -12, uppercase: true } },
  { nombre: 'Titular póster', aplicar: { fontFamily: 'Bebas Neue', fontWeight: 400, fill: relleno('#ffffff'), strokes: [], shadow: sombra('#e3122c', 10, 10), glow: sinGlow, extrude: sinExtr, letterSpacing: 4, uppercase: true } },
  { nombre: 'Marcador', aplicar: { fontFamily: 'Teko', fontWeight: 700, fill: relleno('#00e5ff'), strokes: [{ color: '#000000', width: 4 }], shadow: sinSombra, glow: sinGlow, extrude: sinExtr, skewX: -10, uppercase: true } },
  { nombre: 'Elegante', aplicar: { fontFamily: 'Playfair Display', fontWeight: 900, fill: { type: 'linear', color: '#f7d774', gradient: { colors: ['#fff3b0', '#d4a017'], angle: 90 } }, strokes: [], shadow: sombra('#000000', 0, 6, 18, 0.7), glow: sinGlow, extrude: sinExtr } },
  { nombre: 'Cómic', aplicar: { fontFamily: 'Bangers', fontWeight: 400, fill: relleno('#ffffff'), strokes: [{ color: '#000000', width: 6 }, { color: '#ffd400', width: 8 }], shadow: sombra('#000000', 6, 6), glow: sinGlow, extrude: sinExtr, skewX: -8 } },
];

export async function aplicarEstilo(estilo: EstiloTexto) {
  const { seleccion, doc } = st();
  const ids = doc.layers.filter((l) => seleccion.includes(l.id) && l.type === 'text').map((l) => l.id);
  if (!ids.length) {
    st().avisar('Selecciona una capa de texto.', 'aviso');
    return;
  }
  if (estilo.aplicar.fontFamily) await asegurarFuente(estilo.aplicar.fontFamily, estilo.aplicar.fontWeight ?? 400);
  st().actualizarCapas(ids, (l) => {
    const t = l as TextLayer;
    const escala = t.fontSize / 120; // los estilos están pensados para 120 px
    const a = estilo.aplicar;
    return {
      ...a,
      strokes: a.strokes ? a.strokes.map((s) => ({ ...s, width: s.width * escala })) : t.strokes,
      shadow: a.shadow ? { ...a.shadow, offsetX: a.shadow.offsetX * escala, offsetY: a.shadow.offsetY * escala, blur: a.shadow.blur * escala } : t.shadow,
      extrude: a.extrude ? { ...a.extrude, depth: a.extrude.depth * escala } : t.extrude,
      skewX: a.skewX ?? 0,
      letterSpacing: (a.letterSpacing ?? 0) * escala,
    } as Partial<TextLayer>;
  });
}

/** Añade una superposición o textura (recursos libres) como capa a tamaño completo. */
export async function anadirSuperposicion(url: string, nombre: string, modo: Layer['blendMode']) {
  const { doc } = st();
  const im = await cargarImagen(url);
  const esc = Math.max(doc.width / im.width, doc.height / im.height);
  const capa = nuevaImagen(url, (doc.width - im.width * esc) / 2, (doc.height - im.height * esc) / 2, im.width * esc, im.height * esc, nombre, 'efecto');
  capa.blendMode = modo;
  st().anadirCapa(capa);
}
