/**
 * Cliente HTTP de la ingesta.
 * - Identifica la herramienta con un User-Agent honesto (no se hace pasar por un navegador).
 * - Respeta un intervalo mínimo entre peticiones por dominio (ver HOST_DELAY_MS).
 * - Guarda cada respuesta en caché en disco (.cache/http) para no repetir descargas.
 * - Reintenta ante errores de red y 429/5xx con espera exponencial y respeta Retry-After.
 * - Ante 401/403 NO reintenta ni intenta eludir el bloqueo: lanza un error claro.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const USER_AGENT =
  'SimuladorBaloncesto/1.0 (herramienta personal no comercial; ingesta con cache y limite de peticiones)';

const CACHE_DIR = join(process.cwd(), '.cache', 'http');

/** Milisegundos mínimos entre peticiones a un mismo dominio. */
export const HOST_DELAY_MS: Record<string, number> = {
  'api.pbpstats.com': 2500,
  'api-live.euroleague.net': 800,
  'live.euroleague.net': 800,
  'acb.com': 2500,
  'live.acb.com': 2500,
};
const DEFAULT_DELAY_MS = 2000;

const lastRequestAt = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BlockedError extends Error {}
export class NotFoundError extends Error {}

export interface FetchOptions {
  /** Tiempo máximo de validez de la caché en horas. Infinity = nunca caduca (partidos terminados). */
  maxAgeHours?: number;
  /** Si es true, no lanza error con 404 sino que devuelve null. */
  allow404?: boolean;
  /** Solo caché: si no está en caché devuelve null sin hacer la petición. */
  cacheOnly?: boolean;
}

function cachePath(url: string) {
  const h = createHash('sha1').update(url).digest('hex');
  return join(CACHE_DIR, h.slice(0, 2), h + '.txt');
}

async function throttle(host: string) {
  const delay = HOST_DELAY_MS[host] ?? DEFAULT_DELAY_MS;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + delay - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const maxAgeHours = opts.maxAgeHours ?? 6;
  const p = cachePath(url);
  if (existsSync(p)) {
    const ageH = (Date.now() - statSync(p).mtimeMs) / 3_600_000;
    if (ageH <= maxAgeHours) {
      const txt = readFileSync(p, 'utf8');
      if (txt === '__404__') return opts.allow404 ? null : Promise.reject(new NotFoundError(url));
      return txt;
    }
  }
  if (opts.cacheOnly) return null;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    attempt++;
    await throttle(host);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    if (res.status === 404) {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, '__404__');
      if (opts.allow404) return null;
      throw new NotFoundError(url);
    }
    if (res.status === 401 || res.status === 403) {
      throw new BlockedError(
        `Acceso denegado (${res.status}) en ${url}. La fuente bloquea el acceso automatizado desde esta red: no se intenta eludir.`,
      );
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`HTTP ${res.status} tras ${attempt} intentos: ${url}`);
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const txt = await res.text();
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, txt);
    return txt;
  }
}

export async function fetchJson<T = any>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  const t = await fetchText(url, opts);
  if (t === null) return null;
  return JSON.parse(t) as T;
}

/** Elimina una URL de la caché (por ejemplo, un partido que aún no ha terminado). */
export function dropCache(url: string) {
  const p = cachePath(url);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* sin efecto */
  }
}
