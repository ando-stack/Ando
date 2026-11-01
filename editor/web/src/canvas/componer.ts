import type { Adjustments, ImageEffects } from '../types';
import { hexARgb } from '../utils/color';

/** Caché de imágenes cargadas por URL. */
const imagenes = new Map<string, Promise<HTMLImageElement>>();

export function cargarImagen(url: string): Promise<HTMLImageElement> {
  let p = imagenes.get(url);
  if (!p) {
    p = new Promise((ok, mal) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => ok(im);
      im.onerror = () => {
        imagenes.delete(url);
        mal(new Error(`No se pudo cargar ${url}`));
      };
      im.src = url;
    });
    imagenes.set(url, p);
  }
  return p;
}

export const ajustesNeutros = (a: Adjustments) =>
  !a.brightness && !a.contrast && !a.saturation && !a.temperature && !a.sharpen && !a.blur && a.filter === 'none';

/** Aplica brillo, contraste, saturación, temperatura y filtros de color a unos píxeles. */
export function aplicarAjustes(d: Uint8ClampedArray, a: Adjustments) {
  const br = (a.brightness / 100) * 255 * 0.6;
  const ct = a.contrast / 100;
  const fc = ct >= 0 ? 1 + ct * 2 : 1 + ct; // factor de contraste
  const sat = 1 + a.saturation / 100;
  const temp = a.temperature / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    r += br;
    g += br;
    b += br;
    r = (r - 128) * fc + 128;
    g = (g - 128) * fc + 128;
    b = (b - 128) * fc + 128;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    r += temp * 40;
    b -= temp * 40;
    g += temp * 8;
    switch (a.filter) {
      case 'bn': {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = y;
        break;
      }
      case 'sepia': {
        const [rr, gg, bb] = [r, g, b];
        r = 0.393 * rr + 0.769 * gg + 0.189 * bb;
        g = 0.349 * rr + 0.686 * gg + 0.168 * bb;
        b = 0.272 * rr + 0.534 * gg + 0.131 * bb;
        break;
      }
      case 'frio':
        r *= 0.88;
        b = b * 1.12 + 10;
        break;
      case 'calido':
        r = r * 1.12 + 10;
        b *= 0.86;
        break;
      case 'vintage': {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        r = 0.6 * r + 0.4 * y + 20;
        g = 0.6 * g + 0.4 * y + 8;
        b = 0.6 * b + 0.4 * y - 12;
        r = (r - 128) * 0.85 + 128;
        g = (g - 128) * 0.85 + 128;
        b = (b - 128) * 0.85 + 128;
        break;
      }
      case 'invertir':
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
        break;
      case 'dramatico': {
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        r = (0.5 * r + 0.5 * y - 128) * 1.5 + 128;
        g = (0.5 * g + 0.5 * y - 128) * 1.5 + 128;
        b = (0.5 * b + 0.5 * y - 128) * 1.5 + 118;
        break;
      }
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}

/** Enfoque (máscara de desenfoque) 3×3. */
export function enfocar(img: ImageData, cantidad: number) {
  const { width: w, height: h, data: s } = img;
  const o = new Uint8ClampedArray(s);
  const k = cantidad / 100;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (s[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = 5 * s[i + c] - s[i - 4 + c] - s[i + 4 + c] - s[i - w * 4 + c] - s[i + w * 4 + c];
        o[i + c] = s[i + c] + (v - s[i + c]) * k;
      }
    }
  }
  img.data.set(o);
}

export interface Compuesto {
  canvas: HTMLCanvasElement;
  pad: number; // margen añadido alrededor (contorno, resplandor)
}

/**
 * Compone una capa de imagen: máscara no destructiva, ajustes, contorno alrededor del
 * recorte y resplandor de borde. Devuelve un lienzo con `pad` píxeles de margen.
 */
export function componer(img: CanvasImageSource & { width: number; height: number }, mascara: HTMLImageElement | HTMLCanvasElement | null, a: Adjustments, e: ImageEffects): Compuesto {
  const w = img.width;
  const h = img.height;
  const pad = Math.ceil(Math.max(e.outline.enabled ? e.outline.width + 2 : 0, e.glow.enabled ? e.glow.blur * 1.5 : 0));
  // 1) imagen + máscara + ajustes
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const bc = base.getContext('2d', { willReadFrequently: true })!;
  if (a.blur > 0) bc.filter = `blur(${a.blur}px)`;
  bc.drawImage(img, 0, 0);
  bc.filter = 'none';
  if (mascara) {
    bc.globalCompositeOperation = 'destination-in';
    bc.drawImage(mascara, 0, 0, w, h);
    bc.globalCompositeOperation = 'source-over';
  }
  if (!ajustesNeutros({ ...a, blur: 0 })) {
    const datos = bc.getImageData(0, 0, w, h);
    aplicarAjustes(datos.data, a);
    if (a.sharpen > 0) enfocar(datos, a.sharpen);
    bc.putImageData(datos, 0, 0);
  }
  if (!pad) return { canvas: base, pad: 0 };
  // 2) contorno y resplandor a partir de la silueta
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad * 2;
  const oc = out.getContext('2d')!;
  const silueta = (color: string, dil: number) => {
    const c = document.createElement('canvas');
    c.width = out.width;
    c.height = out.height;
    const cc = c.getContext('2d')!;
    const pasos = Math.max(16, Math.min(64, Math.round(dil * 3)));
    for (let i = 0; i < pasos; i++) {
      const ang = (i / pasos) * Math.PI * 2;
      cc.drawImage(base, pad + Math.cos(ang) * dil, pad + Math.sin(ang) * dil);
    }
    if (dil > 3) cc.drawImage(base, pad, pad);
    cc.globalCompositeOperation = 'source-in';
    cc.fillStyle = color;
    cc.fillRect(0, 0, c.width, c.height);
    return c;
  };
  if (e.glow.enabled) {
    const s = silueta(e.glow.color, e.outline.enabled ? e.outline.width : 2);
    oc.save();
    oc.globalAlpha = Math.min(1, e.glow.strength);
    oc.filter = `blur(${e.glow.blur / 2}px)`;
    oc.drawImage(s, 0, 0);
    if (e.glow.strength > 1) oc.drawImage(s, 0, 0);
    oc.restore();
  }
  if (e.outline.enabled && e.outline.width > 0) {
    const [r, g, b] = hexARgb(e.outline.color);
    oc.drawImage(silueta(`rgb(${r},${g},${b})`, e.outline.width), 0, 0);
  }
  oc.drawImage(base, pad, pad);
  return { canvas: out, pad };
}
