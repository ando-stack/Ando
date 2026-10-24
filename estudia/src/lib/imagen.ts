/**
 * Mejora automática de fotos de apuntes antes de enviarlas a la IA:
 *  1. Recorte del papel (si el fondo es más oscuro que la hoja).
 *  2. Enderezado (detección de inclinación por perfil de proyección).
 *  3. Contraste (estiramiento del histograma entre percentiles 1 y 99).
 *  4. Reducción a un tamaño razonable (lado mayor ≤ 2000 px) para ahorrar datos.
 *
 * Las funciones de análisis son puras (trabajan con arrays) para poder probarlas.
 */

export interface Gris {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function aGris(rgba: Uint8ClampedArray, width: number, height: number): Gris {
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    g[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return { data: g, width, height };
}

/** Umbral de Otsu. */
export function umbralOtsu(g: Gris): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let umbral = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (suma - sumB) / wF;
    const entre = wB * wF * (mB - mF) * (mB - mF);
    if (entre > max) {
      max = entre;
      umbral = t;
    }
  }
  return umbral;
}

/**
 * Detecta la hoja: zona clara rodeada de fondo más oscuro.
 * Devuelve null si no hay un contraste claro (mejor no recortar que recortar mal).
 */
export function detectarHoja(g: Gris): Caja | null {
  const { width: w, height: h, data } = g;
  const u = umbralOtsu(g);
  // proporción de píxeles claros por fila y por columna
  const filas = new Float32Array(h);
  const cols = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] > u) {
        filas[y]++;
        cols[x]++;
      }
    }
  }
  for (let y = 0; y < h; y++) filas[y] /= w;
  for (let x = 0; x < w; x++) cols[x] /= h;
  const limite = 0.5;
  const primero = (a: Float32Array) => a.findIndex((v) => v > limite);
  const ultimo = (a: Float32Array) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i] > limite) return i;
    return -1;
  };
  const y0 = primero(filas);
  const y1 = ultimo(filas);
  const x0 = primero(cols);
  const x1 = ultimo(cols);
  if (y0 < 0 || x0 < 0) return null;
  const caja = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const area = (caja.w * caja.h) / (w * h);
  // Si la hoja ocupa casi todo, o muy poco, no se recorta
  if (area > 0.95 || area < 0.25) return null;
  // margen del 1 %
  const mx = Math.round(w * 0.01);
  const my = Math.round(h * 0.01);
  return {
    x: Math.max(0, caja.x - mx),
    y: Math.max(0, caja.y - my),
    w: Math.min(w - Math.max(0, caja.x - mx), caja.w + 2 * mx),
    h: Math.min(h - Math.max(0, caja.y - my), caja.h + 2 * my),
  };
}

/**
 * Estima la inclinación del texto (grados, positivo = girado en sentido horario)
 * buscando el ángulo que maximiza la varianza del perfil horizontal de tinta.
 */
export function estimarInclinacion(g: Gris, maxGrados = 8, paso = 0.5): number {
  const { width: w, height: h, data } = g;
  const u = umbralOtsu(g);
  const tinta: [number, number][] = [];
  // muestreo para que sea rápido
  const salto = Math.max(1, Math.floor(Math.sqrt((w * h) / 150000)));
  // Solo la zona interior: los bordes pueden incluir fondo (mesa) que falsea la estimación
  const mx = Math.floor(w * 0.12);
  const my = Math.floor(h * 0.08);
  for (let y = my; y < h - my; y += salto) {
    for (let x = mx; x < w - mx; x += salto) {
      if (data[y * w + x] < u) tinta.push([x - w / 2, y - h / 2]);
    }
  }
  if (tinta.length < 50) return 0;
  const tinteoRatio = tinta.length / (((w - 2 * mx) / salto) * ((h - 2 * my) / salto));
  if (tinteoRatio > 0.5) return 0; // imagen muy oscura: no fiable
  let mejor = 0;
  let mejorVar = -1;
  const bins = Math.ceil(h * 1.5);
  for (let a = -maxGrados; a <= maxGrados + 1e-9; a += paso) {
    const rad = (a * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const perfil = new Float32Array(bins);
    for (const [x, y] of tinta) {
      const yr = Math.round(y * cos - x * sin + bins / 2);
      if (yr >= 0 && yr < bins) perfil[yr]++;
    }
    let media = 0;
    for (let i = 0; i < bins; i++) media += perfil[i];
    media /= bins;
    let v = 0;
    for (let i = 0; i < bins; i++) v += (perfil[i] - media) ** 2;
    if (v > mejorVar + 1e-6) {
      mejorVar = v;
      mejor = a;
    }
  }
  return Math.abs(mejor) < paso ? 0 : mejor;
}

/** Percentiles para estirar el contraste. */
export function percentiles(g: Gris, bajo = 0.01, alto = 0.99): [number, number] {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const n = g.data.length;
  let acc = 0;
  let p0 = 0;
  let p1 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= n * bajo) {
      p0 = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= n * (1 - alto)) {
      p1 = i;
      break;
    }
  }
  return p1 - p0 < 30 ? [0, 255] : [p0, p1];
}

export function estirarContraste(rgba: Uint8ClampedArray, p0: number, p1: number): void {
  const escala = 255 / Math.max(1, p1 - p0);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (rgba[i] - p0) * escala;
    rgba[i + 1] = (rgba[i + 1] - p0) * escala;
    rgba[i + 2] = (rgba[i + 2] - p0) * escala;
  }
}

/** Nitidez aproximada (varianza del laplaciano). Valores bajos = foto borrosa. */
export function nitidez(g: Gris): number {
  const { width: w, height: h, data } = g;
  let suma = 0;
  let suma2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      suma += lap;
      suma2 += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const media = suma / n;
  return suma2 / n - media * media;
}

export interface ResultadoMejora {
  blob: Blob;
  ancho: number;
  alto: number;
  recortada: boolean;
  giroGrados: number;
  /** true si parece borrosa (se avisa al estudiante antes de enviarla) */
  posibleBorrosa: boolean;
}

const LADO_MAX = 2000;

/** Mejora una foto en el navegador (usa canvas). */
export async function mejorarFoto(archivo: Blob): Promise<ResultadoMejora> {
  const bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" } as ImageBitmapOptions);
  // Análisis sobre una copia pequeña
  const escalaAnalisis = Math.min(1, 700 / Math.max(bmp.width, bmp.height));
  const aw = Math.max(1, Math.round(bmp.width * escalaAnalisis));
  const ah = Math.max(1, Math.round(bmp.height * escalaAnalisis));
  const ca = document.createElement("canvas");
  ca.width = aw;
  ca.height = ah;
  const xa = ca.getContext("2d", { willReadFrequently: true })!;
  xa.drawImage(bmp, 0, 0, aw, ah);
  const gris = aGris(xa.getImageData(0, 0, aw, ah).data, aw, ah);
  const hoja = detectarHoja(gris);
  const zona: Caja = hoja
    ? { x: hoja.x / escalaAnalisis, y: hoja.y / escalaAnalisis, w: hoja.w / escalaAnalisis, h: hoja.h / escalaAnalisis }
    : { x: 0, y: 0, w: bmp.width, h: bmp.height };

  // Inclinación sobre la zona recortada
  const cz = document.createElement("canvas");
  const ez = Math.min(1, 560 / Math.max(zona.w, zona.h));
  cz.width = Math.max(1, Math.round(zona.w * ez));
  cz.height = Math.max(1, Math.round(zona.h * ez));
  const xz = cz.getContext("2d", { willReadFrequently: true })!;
  xz.drawImage(bmp, zona.x, zona.y, zona.w, zona.h, 0, 0, cz.width, cz.height);
  const grisZona = aGris(xz.getImageData(0, 0, cz.width, cz.height).data, cz.width, cz.height);
  const giro = estimarInclinacion(grisZona);
  const borrosa = nitidez(grisZona) < 60;

  // Composición final
  const escala = Math.min(1, LADO_MAX / Math.max(zona.w, zona.h));
  const fw = Math.round(zona.w * escala);
  const fh = Math.round(zona.h * escala);
  const cf = document.createElement("canvas");
  cf.width = fw;
  cf.height = fh;
  const xf = cf.getContext("2d", { willReadFrequently: true })!;
  xf.fillStyle = "#fff";
  xf.fillRect(0, 0, fw, fh);
  xf.translate(fw / 2, fh / 2);
  xf.rotate((-giro * Math.PI) / 180);
  xf.drawImage(bmp, zona.x, zona.y, zona.w, zona.h, -fw / 2, -fh / 2, fw, fh);
  xf.setTransform(1, 0, 0, 1, 0, 0);
  const img = xf.getImageData(0, 0, fw, fh);
  const [p0, p1] = percentiles(aGris(img.data, fw, fh));
  estirarContraste(img.data, p0, p1);
  xf.putImageData(img, 0, 0);
  bmp.close();

  const blob = await new Promise<Blob>((ok, mal) =>
    cf.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo procesar la imagen"))), "image/jpeg", 0.88),
  );
  return { blob, ancho: fw, alto: fh, recortada: Boolean(hoja), giroGrados: giro, posibleBorrosa: borrosa };
}
