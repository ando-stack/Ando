/**
 * Descargas con caché en disco, límite de peticiones por dominio y reintentos con espera
 * exponencial. Nunca se intenta eludir un bloqueo: un 401/403 se registra como fallo de la fuente
 * y se siguen usando los últimos datos válidos.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR_CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

/** Intervalo mínimo entre peticiones a cada dominio (ms). */
const INTERVALO: Record<string, number> = {
  'en.wikipedia.org': 1500,
  'api.wtatennis.com': 400,
  'site.api.espn.com': 400,
  'sports.core.api.espn.com': 400,
  'huggingface.co': 300,
};
const ultimaPeticion = new Map<string, number>();

const USER_AGENT = 'SimuladorTenis/1.0 (proyecto no comercial de análisis; ingesta con caché y límites de peticiones)';

export class ErrorFuente extends Error {
  constructor(
    msg: string,
    readonly estado?: number,
  ) {
    super(msg);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function turno(host: string) {
  const min = INTERVALO[host] ?? 500;
  const ult = ultimaPeticion.get(host) ?? 0;
  const falta = ult + min - Date.now();
  if (falta > 0) await esperar(falta);
  ultimaPeticion.set(host, Date.now());
}

export interface OpcionesDescarga {
  /** Validez de la caché en segundos (Infinity = siempre válida si existe). */
  ttl?: number;
  /** Si la descarga falla, devolver la copia en caché aunque esté caducada. */
  usarCaducada?: boolean;
  intentos?: number;
}

function rutaCache(url: string): string {
  const h = createHash('sha1').update(url).digest('hex');
  return join(DIR_CACHE, 'http', h.slice(0, 2), h);
}

export async function descargarTexto(url: string, op: OpcionesDescarga = {}): Promise<{ texto: string; desdeCache: boolean; fecha: Date }> {
  const { ttl = 3600, usarCaducada = true, intentos = 5 } = op;
  const ruta = rutaCache(url);
  if (existsSync(ruta)) {
    const st = statSync(ruta);
    if ((Date.now() - st.mtimeMs) / 1000 < ttl) return { texto: readFileSync(ruta, 'utf8'), desdeCache: true, fecha: st.mtime };
  }
  const host = new URL(url).host;
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    await turno(host);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/csv, */*' } });
      if (r.status === 429 || r.status >= 500) {
        // Respetamos Retry-After si la fuente lo indica (máx. 60 s).
        const retry = Number(r.headers.get('retry-after'));
        if (retry > 0) await esperar(Math.min(retry, 60) * 1000);
        throw new ErrorFuente(`HTTP ${r.status}`, r.status);
      }
      if (!r.ok) {
        // 4xx (incluidos 401/403): no se reintenta ni se intenta eludir.
        const e = new ErrorFuente(`HTTP ${r.status} en ${url}`, r.status);
        ultimoError = e;
        break;
      }
      const texto = await r.text();
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(ruta, texto);
      return { texto, desdeCache: false, fecha: new Date() };
    } catch (e) {
      ultimoError = e;
      if (e instanceof ErrorFuente && e.estado && e.estado < 500 && e.estado !== 429) break;
      await esperar(2000 * 2 ** i);
    }
  }
  if (usarCaducada && existsSync(ruta)) {
    const st = statSync(ruta);
    return { texto: readFileSync(ruta, 'utf8'), desdeCache: true, fecha: st.mtime };
  }
  throw ultimoError instanceof Error ? ultimoError : new ErrorFuente(String(ultimoError));
}

export async function descargarJson<T = unknown>(url: string, op: OpcionesDescarga = {}): Promise<T> {
  const { texto } = await descargarTexto(url, op);
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorFuente(`Respuesta no JSON de ${url}: ${texto.slice(0, 120)}`);
  }
}
