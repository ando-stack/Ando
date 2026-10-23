/**
 * Wikipedia (en.wikipedia.org, API de MediaWiki): calendario del ATP Challenger Tour y del ATP
 * Tour (superficie, pista cubierta "(i)", categoría) y cuadros de los Challenger.
 * Licencia CC BY-SA 4.0 (atribución, compartir igual). Se respeta la política de la API: agente
 * de usuario identificado, peticiones en serie (≥ 1,5 s), maxlag y caché.
 * Los cuadros los mantienen voluntarios: pueden ir con retraso respecto a la web oficial.
 */
import type { Superficie } from '../../config/formatos';
import { descargarJson } from '../lib/http';
import { superficie } from '../lib/util';

const API = 'https://en.wikipedia.org/w/api.php';
export const FUENTE_WIKI = 'wiki';

export async function wikitexto(pagina: string, ttl: number): Promise<string | null> {
  const url = `${API}?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&maxlag=5&page=${encodeURIComponent(pagina)}`;
  const d = await descargarJson<{ parse?: { wikitext: string }; error?: { code: string } }>(url, { ttl });
  if (d.error || !d.parse) return null;
  return d.parse.wikitext;
}

export interface EntradaCalendario {
  semana: string; // YYYY-MM-DD (lunes)
  pagina: string | null;
  nombre: string;
  ciudad: string;
  pais: string;
  superficie: Superficie | null;
  cubierta: boolean;
  categoria: string;
  paginaIndividual: string | null;
}

const MESES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const MES_CORTO = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/** "October 19", "Oct 19", "19 October" o "19 Oct" → YYYY-MM-DD. */
export function fechaSemana(t: string, anio: number): string | null {
  const m1 = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})$/);
  const m2 = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/);
  const [mesTxt, dia] = m1 ? [m1[1], m1[2]] : m2 ? [m2[2], m2[1]] : [null, null];
  if (!mesTxt || !dia || !MES_CORTO.test(mesTxt)) return null;
  const mes = Object.entries(MESES).find(([k]) => k.startsWith(mesTxt.toLowerCase().slice(0, 3)))?.[1];
  if (!mes) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

/** Quita el marcado wiki de un trozo de texto. */
export function limpiar(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{flagicon\|[^}]*\}\}/gi, '')
    .replace(/\{\{nowrap\|([^}]*)\}\}/gi, '$1')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primer enlace [[destino|texto]] de un trozo. */
function enlace(s: string): { destino: string; texto: string } | null {
  const m = s.match(/\[\[([^|\]]+)(?:\|([^\]]*))?\]\]/);
  if (!m) return null;
  return { destino: m[1].trim(), texto: (m[2] ?? m[1]).trim() };
}

/**
 * Lee las tablas de calendario ("2026 ATP Challenger Tour", "2026 ATP Tour"): cada celda de torneo
 * contiene nombre, ciudad, "Superficie – Categoría – cuadro" y enlace al cuadro individual.
 */
export function parsearCalendario(texto: string, anio: number): EntradaCalendario[] {
  const res: EntradaCalendario[] = [];
  let semana: string | null = null;
  const celdas = texto.split(/\n\|-[^\n]*\n|\|\||\n\|/);
  for (const celdaBruta of celdas) {
    const celda = celdaBruta
      .replace(/^\s*\|+/, '')
      .replace(/^\s*(?:rowspan|colspan|style|align|valign)=[^|[]*\|/i, '')
      .trim();
    const sem = fechaSemana(limpiar(celda), anio);
    if (sem) {
      semana = sem;
      continue;
    }
    if (!semana || !/<br\s*\/?>/i.test(celda)) continue;
    const lineas = celda.split(/<br\s*\/?>/i).map((l) => l.trim());
    const lineaSup = lineas.find((l) => /\b(Hard|Clay|Grass|Carpet)\b/i.test(limpiar(l)) && /(–|-)/.test(l));
    if (!lineaSup) continue;
    const textoSup = limpiar(lineaSup);
    const sup = superficie(textoSup.match(/\b(Hard|Clay|Grass|Carpet)\b/i)?.[1] ?? '');
    const cubierta = /\(i\)/i.test(textoSup) || /carpet/i.test(textoSup);
    const categoria =
      textoSup.match(/Challenger \d+/i)?.[0] ??
      limpiar(lineas.join(' ')).match(/(ATP Masters 1000|ATP 1000|ATP Finals|ATP 500|ATP 250|Grand Slam|Next Gen ATP Finals|United Cup|Laver Cup|Davis Cup|WTA 125|WTA 1000|WTA 500|WTA 250)/i)?.[0] ??
      '';
    const primero = enlace(lineas[0]);
    const nombre = limpiar(lineas[0]);
    if (!nombre || /^(singles|doubles)$/i.test(nombre)) continue;
    const lugar = limpiar(lineas[1] ?? '');
    const [ciudad, ...resto] = lugar.split(',');
    const enlaceInd = lineas.map((l) => [...l.matchAll(/\[\[([^|\]]+)\|\s*Singles\s*\]\]/gi)][0]).find(Boolean);
    res.push({
      semana,
      pagina: primero?.destino ?? null,
      nombre,
      ciudad: (ciudad ?? '').trim(),
      pais: resto.join(',').trim(),
      superficie: sup,
      cubierta,
      categoria,
      paginaIndividual: enlaceInd ? enlaceInd[1].trim() : primero ? `${primero.destino} – Singles` : null,
    });
  }
  return res;
}

export interface JugadorCuadro {
  nombre: string;
  /** true si el nombre viene de un enlace (nombre completo). */
  completo: boolean;
  pais: string;
  semilla: string;
}

export interface PartidoCuadro {
  fase: 'Q' | 'M';
  ronda: string;
  orden: number;
  a: JugadorCuadro | null;
  b: JugadorCuadro | null;
  /** Juegos por set [a, b] y puntos del perdedor del tie-break. */
  sets: { a: number; b: number; tb: number | null }[];
  ganador: 'a' | 'b' | null;
  retirada: boolean;
  wo: boolean;
}

function jugadorDe(celda: string, semilla: string): JugadorCuadro | null {
  if (!celda || /bye/i.test(celda)) return null;
  const pais = celda.match(/\{\{flagicon\|([A-Z]{3})/i)?.[1]?.toUpperCase() ?? '';
  const e = enlace(celda);
  const nombre = e ? e.destino.replace(/\s*\(.*?\)\s*$/, '').trim() : limpiar(celda);
  if (!nombre) return null;
  return { nombre, completo: Boolean(e), pais, semilla: semilla.trim() };
}

/** Plantillas {{NTeamBracket...}} con llaves equilibradas. */
function plantillasCuadro(texto: string): { equipos: number; cuerpo: string; inicio: number }[] {
  const res: { equipos: number; cuerpo: string; inicio: number }[] = [];
  const re = /\{\{(\d+)TeamBracket/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    let prof = 0;
    let j = m.index;
    for (; j < texto.length - 1; j++) {
      if (texto[j] === '{' && texto[j + 1] === '{') {
        prof++;
        j++;
      } else if (texto[j] === '}' && texto[j + 1] === '}') {
        prof--;
        j++;
        if (prof === 0) break;
      }
    }
    res.push({ equipos: Number(m[1]), cuerpo: texto.slice(m.index, j - 1), inicio: m.index });
    re.lastIndex = j;
  }
  return res;
}

function rondaPorEtiqueta(etiqueta: string, tam: number): string | null {
  const e = etiqueta.toLowerCase().trim();
  if (/semi/.test(e)) return 'SF';
  if (/quarter/.test(e)) return 'QF';
  if (/^final/.test(e)) return 'F';
  const ord = ['first', 'second', 'third', 'fourth', 'fifth'].findIndex((o) => e.startsWith(o));
  if (ord >= 0) return `R${tam / 2 ** ord}`;
  return null;
}

const NEGRITA = "'''";

/**
 * Lee las plantillas de cuadro ({{16TeamBracket-Compact-Tennis3 ...}}, {{4TeamBracket-Tennis3}},
 * etc.) de una página de cuadro individual. La sección "Finals" da semifinales y final; "Top half",
 * "Bottom half" o "Section N" el resto; las secciones bajo "Qualifying" son la fase previa.
 */
export function parsearCuadro(texto: string): PartidoCuadro[] {
  const res: PartidoCuadro[] = [];
  const bloques = plantillasCuadro(texto);
  const titulos = [...texto.matchAll(/^(==+)\s*([^=]+?)\s*==+\s*$/gm)].map((x) => ({ pos: x.index ?? 0, t: x[1] && x[2].toLowerCase() }));
  const contexto = (pos: number) => {
    const previos = titulos.filter((h) => h.pos < pos);
    const ultimo = previos[previos.length - 1]?.t ?? '';
    const qualy = previos.some((h) => /qualif/.test(h.t));
    return { ultimo, qualy };
  };
  const leer = (cuerpo: string) => {
    const params = new Map<string, string>();
    for (const linea of cuerpo.split(/\n\s*\|/)) {
      const k = linea.indexOf('=');
      if (k > 0) params.set(linea.slice(0, k).trim().replace(/^\|/, ''), linea.slice(k + 1).trim());
    }
    return params;
  };
  const info = bloques.map((b) => ({ ...b, ...contexto(b.inicio), params: leer(b.cuerpo) }));
  const tamMain =
    info.filter((b) => !b.qualy && /first/i.test(b.params.get('RD1') ?? '')).reduce((a, b) => a + b.equipos, 0) ||
    info.filter((b) => !b.qualy && !/final/.test(b.ultimo)).reduce((a, b) => a + b.equipos, 0) ||
    32;
  let orden = 0;
  for (const b of info) {
    const { params } = b;
    const esFinales = !b.qualy && /final/.test(b.ultimo);
    const nRondas = Math.round(Math.log2(b.equipos));
    for (let rd = 1; rd <= nRondas; rd++) {
      const nEnRonda = b.equipos / 2 ** (rd - 1);
      const etiqueta = params.get(`RD${rd}`) ?? '';
      let ronda: string;
      if (b.qualy) ronda = `Q${rd}`;
      else if (esFinales) ronda = nEnRonda === 4 ? 'SF' : nEnRonda === 2 ? 'F' : 'QF';
      else ronda = rondaPorEtiqueta(etiqueta, tamMain) ?? `R${(tamMain / b.equipos) * nEnRonda}`;
      for (let k = 1; k <= nEnRonda; k += 2) {
        const idx = (n: number) => String(n).padStart(2, '0');
        const ta = params.get(`RD${rd}-team${idx(k)}`) ?? '';
        const tb = params.get(`RD${rd}-team${idx(k + 1)}`) ?? '';
        const a = jugadorDe(ta, params.get(`RD${rd}-seed${idx(k)}`) ?? '');
        const bb = jugadorDe(tb, params.get(`RD${rd}-seed${idx(k + 1)}`) ?? '');
        if (!a && !bb) continue;
        const sets: PartidoCuadro['sets'] = [];
        let retirada = false;
        let wo = false;
        for (let s = 1; s <= 5; s++) {
          const sa = params.get(`RD${rd}-score${idx(k)}-${s}`) ?? '';
          const sb = params.get(`RD${rd}-score${idx(k + 1)}-${s}`) ?? '';
          const txt = `${sa} ${sb}`;
          if (/ret/i.test(txt)) retirada = true;
          if (/w\/o|walkover/i.test(txt)) wo = true;
          const na = limpiar(sa).match(/^(\d+)/);
          const nb = limpiar(sb).match(/^(\d+)/);
          if (!na || !nb) continue;
          const tbA = sa.match(/<sup>(\d+)<\/sup>/)?.[1];
          const tbB = sb.match(/<sup>(\d+)<\/sup>/)?.[1];
          sets.push({ a: Number(na[1]), b: Number(nb[1]), tb: tbA !== undefined && tbB !== undefined ? Math.min(+tbA, +tbB) : null });
        }
        const negA = ta.includes(NEGRITA);
        const negB = tb.includes(NEGRITA);
        const ganador = negA && !negB ? 'a' : negB && !negA ? 'b' : null;
        res.push({ fase: b.qualy ? 'Q' : 'M', ronda, orden: orden++, a, b: bb, sets, ganador, retirada, wo });
      }
    }
  }
  // Nombres abreviados sin enlace ("S Gulin"): se completan con el nombre completo del mismo cuadro.
  const abreviado = /^(\p{L}{1,2})\s+(.+)$/u;
  const completos = res.flatMap((p) => [p.a, p.b]).filter((j): j is JugadorCuadro => Boolean(j && /\s/.test(j.nombre) && !abreviado.test(j.nombre)));
  for (const p of res) {
    for (const j of [p.a, p.b]) {
      if (!j) continue;
      const m = j.nombre.match(abreviado);
      if (!m) continue;
      const c = completos.find((x) => x.nombre.endsWith(` ${m[2]}`) && x.nombre.startsWith(m[1][0]));
      if (c) {
        j.nombre = c.nombre;
        j.completo = true;
        if (!j.pais) j.pais = c.pais;
      }
    }
  }
  return res;
}
