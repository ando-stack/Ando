export type TipoExport = 'png' | 'jpg' | 'webp';

export const MIME: Record<TipoExport, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function lienzoABlob(c: HTMLCanvasElement, tipo: TipoExport, calidad: number): Promise<Blob> {
  return new Promise((ok, mal) => {
    if (tipo === 'jpg') {
      // JPG no admite transparencia: se pinta sobre blanco
      const fondo = document.createElement('canvas');
      fondo.width = c.width;
      fondo.height = c.height;
      const ctx = fondo.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(c, 0, 0);
      c = fondo;
    }
    c.toBlob((b) => (b ? ok(b) : mal(new Error('El navegador no pudo codificar la imagen.'))), MIME[tipo], calidad);
  });
}

/**
 * Busca la mayor calidad (0.4–1) cuyo archivo no supere `maxBytes` (búsqueda binaria).
 * `codificar` recibe la calidad y devuelve el tamaño/archivo. Si ni con la mínima cabe,
 * devuelve la mínima y `cabe=false`.
 */
export async function ajustarCalidad<T extends { size: number }>(
  codificar: (q: number) => Promise<T>,
  maxBytes: number,
  calidadInicial: number,
  minima = 0.4,
): Promise<{ resultado: T; calidad: number; cabe: boolean }> {
  const primero = await codificar(calidadInicial);
  if (primero.size <= maxBytes) return { resultado: primero, calidad: calidadInicial, cabe: true };
  let lo = minima;
  let hi = calidadInicial;
  let mejor: { resultado: T; calidad: number } | null = null;
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2;
    const r = await codificar(q);
    if (r.size <= maxBytes) {
      mejor = { resultado: r, calidad: q };
      lo = q;
    } else hi = q;
  }
  if (mejor) return { ...mejor, cabe: true };
  const ultimo = await codificar(minima);
  return { resultado: ultimo, calidad: minima, cabe: ultimo.size <= maxBytes };
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const formatoBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

export const nombreArchivo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'diseno';
