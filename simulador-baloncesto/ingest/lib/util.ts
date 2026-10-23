import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function log(...a: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

export function writeJson(rel: string, data: unknown) {
  const p = join(process.cwd(), rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data));
}

export function readJson<T = any>(rel: string): T | null {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

/** Normaliza posiciones de las distintas fuentes a G (exterior), F (alero/ala-pívot) o C (pívot). */
export function normPosition(raw: string | null | undefined): 'G' | 'F' | 'C' | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/(p[ií]vot|center|centre|^c$)/.test(s) && !/ala/.test(s)) return 'C';
  if (/(ala-p[ií]vot|ala p[ií]vot|power|forward|alero|^f$|^pf$|^sf$)/.test(s)) return 'F';
  if (/(base|escolta|guard|^g$|^pg$|^sg$)/.test(s)) return 'G';
  return null;
}

/** Normaliza un nombre para emparejar el mismo jugador entre competiciones. */
export function normName(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "HOLLATZ, JUSTUS" -> "Justus Hollatz" */
export function prettyName(n: string): string {
  const cap = (s: string) =>
    s
      .toLowerCase()
      .split(/([ \-'])/)
      .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w))
      .join('');
  if (n.includes(',')) {
    const [last, first] = n.split(',').map((x) => x.trim());
    return cap(`${first} ${last}`.trim());
  }
  return n;
}
