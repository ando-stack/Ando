import { api } from './api';
import type { CustomFont } from './types';

export interface FamiliaFuente {
  familia: string;
  categoria: string;
  licencia: string;
  origen: 'biblioteca' | 'google' | 'propia';
  ficheros: { url: string; peso: number; variable: boolean }[];
}

let biblioteca: FamiliaFuente[] = [];
const cargadas = new Map<string, Promise<void>>();

export async function cargarBiblioteca(): Promise<FamiliaFuente[]> {
  if (biblioteca.length) return biblioteca;
  const datos = await api.fuentes();
  biblioteca = datos.map((d) => ({ ...d, origen: 'biblioteca' as const }));
  return biblioteca;
}

export const familias = () => biblioteca;

/** Registra (una vez) las caras de una familia de la biblioteca local. */
function registrar(f: FamiliaFuente): Promise<void> {
  const clave = `${f.origen}:${f.familia}`;
  const prev = cargadas.get(clave);
  if (prev) return prev;
  const p = Promise.all(
    f.ficheros.map(async (fi) => {
      const cara = new FontFace(f.familia, `url(${fi.url})`, fi.variable ? { weight: '100 900' } : { weight: String(fi.peso) });
      await cara.load();
      document.fonts.add(cara);
    }),
  ).then(() => undefined);
  cargadas.set(clave, p);
  return p;
}

/** Garantiza que la fuente está cargada antes de dibujar o medir texto. */
export async function asegurarFuente(familia: string, peso = 400): Promise<boolean> {
  const f = biblioteca.find((b) => b.familia === familia);
  try {
    if (f) await registrar(f);
    await document.fonts.load(`${peso} 64px "${familia}"`);
    return document.fonts.check(`${peso} 64px "${familia}"`);
  } catch {
    return false;
  }
}

/** Carga una familia del catálogo de Google Fonts por nombre (petición externa a Google
 * con el nombre de la fuente; no se envía ninguna imagen). */
export async function cargarGoogleFont(nombre: string): Promise<FamiliaFuente> {
  const fam = nombre.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{2,60}$/.test(fam)) throw new Error('Nombre de fuente no válido.');
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}:wght@400;700;900&display=swap`;
  await new Promise<void>((ok, mal) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => ok();
    link.onerror = () => mal(new Error('No se encontró esa fuente en Google Fonts.'));
    document.head.appendChild(link);
  });
  await document.fonts.load(`400 64px "${fam}"`);
  if (!document.fonts.check(`400 64px "${fam}"`)) throw new Error('No se encontró esa fuente en Google Fonts.');
  const f: FamiliaFuente = { familia: fam, categoria: 'google', licencia: 'Google Fonts', origen: 'google', ficheros: [] };
  if (!biblioteca.some((b) => b.familia === fam)) biblioteca = [...biblioteca, f];
  return f;
}

/** Fuentes propias subidas por el usuario (guardadas en el proyecto). */
export async function registrarPropias(propias: CustomFont[]) {
  for (const p of propias) {
    if (cargadas.has(`propia:${p.family}`)) continue;
    const cara = new FontFace(p.family, `url(${p.url})`);
    const pr = cara.load().then((c) => {
      document.fonts.add(c);
    });
    cargadas.set(`propia:${p.family}`, pr);
    try {
      await pr;
      if (!biblioteca.some((b) => b.familia === p.family))
        biblioteca = [...biblioteca, { familia: p.family, categoria: 'propia', licencia: 'propia', origen: 'propia', ficheros: [] }];
    } catch {
      /* fuente dañada: se ignora */
    }
  }
}

const lienzoMedida = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** Métrica de la tinta de una línea tal y como la dibuja Konva (línea base alfabética). */
export function medirTinta(texto: string, familia: string, peso: number, tam: number, cursiva = false, lineHeight = 1) {
  const ctx = lienzoMedida?.getContext('2d');
  if (!ctx) return { izq: 0, arriba: 0, ancho: tam * texto.length * 0.5, alto: tam };
  ctx.font = `${cursiva ? 'italic ' : ''}${peso} ${tam}px "${familia}"`;
  const m = ctx.measureText('M');
  const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  const base = (asc - desc) / 2 + (lineHeight * tam) / 2;
  const t = ctx.measureText(texto);
  return {
    izq: -t.actualBoundingBoxLeft,
    arriba: base - t.actualBoundingBoxAscent,
    ancho: t.actualBoundingBoxLeft + t.actualBoundingBoxRight,
    alto: t.actualBoundingBoxAscent + t.actualBoundingBoxDescent,
  };
}
