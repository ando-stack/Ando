import type { Superficie } from '../../config/formatos';

/** Días desde 1970-01-01 (UTC) de una fecha YYYYMMDD o YYYY-MM-DD. */
export function dias(fecha: string | number): number {
  const s = String(fecha).replace(/-/g, '');
  const y = +s.slice(0, 4);
  const m = +s.slice(4, 6);
  const d = +s.slice(6, 8);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function fechaDeDias(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10);
}

export function hoyDias(): number {
  return Math.floor(Date.now() / 86400000);
}

/** Fecha y hora en Europe/Madrid ("2026-10-24 15:00"). */
export function horaMadrid(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

export function superficie(s: string | null | undefined): Superficie | null {
  const x = (s ?? '').toLowerCase();
  if (/clay|tierra|terre/.test(x)) return 'tierra';
  if (/grass|hierba/.test(x)) return 'hierba';
  if (/hard|carpet|dura|indoor|acrylic/.test(x)) return 'dura';
  return null;
}

/** Clave de nombre: sin acentos, en minúsculas, con las palabras ordenadas (tolera el orden chino). */
export function claveNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
