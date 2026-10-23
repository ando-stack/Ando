/**
 * API pública de wtatennis.com (api.wtatennis.com): la usa la web oficial de la WTA para mostrar
 * calendario, cuadros, órdenes de juego, resultados y estadísticas. No está documentada como API
 * para terceros ni tiene términos específicos: se usa sólo para uso personal/no comercial, con
 * caché, pocas peticiones (≥ 400 ms entre ellas) y sin eludir ningún bloqueo.
 * Cubre WTA (250/500/1000, Grand Slams, Finals) y WTA 125.
 */
import { formatoDe, type Circuito } from '../../config/formatos';
import type { PartidoNormalizado } from '../../engine/perfiles';
import type { PartidoVivo, TorneoVivo } from '../../src/lib/tiposDatos';
import { descargarJson } from '../lib/http';
import type { Registro } from '../lib/registro';
import { dias, superficie } from '../lib/util';

const API = 'https://api.wtatennis.com/tennis';
export const FUENTE_WTA = 'wta';

interface TorneoApi {
  tournamentGroup: { id: number; name: string; level: string };
  year: number;
  title: string;
  startDate: string;
  endDate: string;
  surface: string;
  inOutdoor: string;
  city: string;
  country: string;
  singlesDrawSize: number;
  status: string;
  level: string;
}

interface PartidoApi {
  MatchID: string;
  DrawLevelType: string;
  DrawMatchType: string;
  RoundID: string | number;
  MatchState: string;
  MatchTimeStamp?: string;
  NotBefore?: string;
  NotBeforeText?: string;
  CourtName?: string | null;
  CourtID?: number;
  PlayerIDA: string;
  PlayerIDB: string;
  PlayerNameFirstA: string;
  PlayerNameLastA: string;
  PlayerNameFirstB: string;
  PlayerNameLastB: string;
  PlayerCountryA: string;
  PlayerCountryB: string;
  SeedA?: string;
  SeedB?: string;
  EntryTypeA?: string;
  EntryTypeB?: string;
  Winner?: string;
  ScoreString?: string;
  ResultString?: string;
  [k: string]: unknown;
}

interface StatsApi {
  setnum: number;
  acesa: number;
  acesb: number;
  dblflta: number;
  dblfltb: number;
  ptswon1stserva: number;
  ptswon1stservb: number;
  ptsplayed1stserva: number;
  ptsplayed1stservb: number;
  ptstotwonserva: number;
  ptstotwonservb: number;
  totservplayeda: number;
  totservplayedb: number;
  breakptsconva: number;
  breakptsconvb: number;
  breakptsplayeda: number;
  breakptsplayedb: number;
  servgamesplayeda: number;
  servgamesplayedb: number;
}

export function circuitoDeNivel(level: string): Circuito | null {
  if (/125/.test(level)) return 'W125';
  if (/ITF/i.test(level)) return null;
  return 'WTA';
}

export async function calendarioWta(desde: string, hasta: string, ttl = 6 * 3600): Promise<TorneoApi[]> {
  const res: TorneoApi[] = [];
  for (let page = 0; page < 10; page++) {
    const d = await descargarJson<{ content: TorneoApi[]; pageInfo: { numEntries: number } }>(
      `${API}/tournaments/?page=${page}&pageSize=100&excludeLevels=ITF&from=${desde}&to=${hasta}`,
      { ttl },
    );
    res.push(...(d.content ?? []));
    if (!d.content || d.content.length < 100) break;
  }
  return res;
}

export function torneoVivoWta(t: TorneoApi, actualizado: string, hoy: string): TorneoVivo | null {
  const circuito = circuitoDeNivel(t.level ?? t.tournamentGroup.level);
  if (!circuito) return null;
  const nombre = t.title.split(' - ')[0].trim();
  const formato = formatoDe({ circuito, categoria: t.level, nombreTorneo: `${t.tournamentGroup.name} ${nombre}` });
  const formatoQ = formatoDe({ circuito, categoria: t.level, nombreTorneo: `${t.tournamentGroup.name} ${nombre}`, esCuadroFinal: false });
  return {
    id: `wta-${t.tournamentGroup.id}-${t.year}`,
    circuito,
    categoria: t.level,
    nombre,
    ciudad: titulo(t.city),
    pais: t.country,
    inicio: t.startDate,
    fin: t.endDate,
    superficie: superficie(t.surface),
    cubierta: t.inOutdoor === 'I' ? true : t.inOutdoor === 'O' ? false : null,
    formatoId: formato.id,
    formatoQualyId: formatoQ.id,
    estado: t.endDate < hoy ? 'terminado' : t.startDate > hoy ? 'próximo' : 'en curso',
    fuente: 'WTA (api.wtatennis.com)',
    actualizado,
    nPartidos: 0,
    tieneOrdenDeJuego: false,
    avisos: [],
  };
}

const titulo = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function ronda(p: PartidoApi, tamCuadro: number): string {
  const r = String(p.RoundID);
  if (p.DrawLevelType === 'Q') return `Q${r}`;
  if (r === 'Q') return 'QF';
  if (r === 'S') return 'SF';
  if (r === 'F') return 'F';
  const n = Number(r);
  if (!Number.isFinite(n)) return r;
  const tam = 2 ** Math.ceil(Math.log2(Math.max(8, tamCuadro || 32)));
  return `R${tam / 2 ** (n - 1)}`;
}

/** Marcador desde la perspectiva del ganador, al estilo Sackmann ("7-6(4) 3-6 6-3", "6-1 3-4 RET"). */
function marcadorGanador(p: PartidoApi, ganaA: boolean): string {
  const partes: string[] = [];
  for (let s = 1; s <= 5; s++) {
    const a = p[`ScoreSet${s}A`] as string;
    const b = p[`ScoreSet${s}B`] as string;
    if (a === '' || a === undefined || b === '' || b === undefined) break;
    const tb = (p[`ScoreTbSet${s}`] as string) || '';
    const [x, y] = ganaA ? [a, b] : [b, a];
    partes.push(`${x}-${y}${tb ? `(${tb})` : ''}`);
  }
  const txt = `${p.ScoreString ?? ''} ${p.ResultString ?? ''}`;
  if (/ret/i.test(txt)) partes.push('RET');
  return partes.join(' ');
}

export interface ResultadoTorneoWta {
  partidosVivos: PartidoVivo[];
  terminados: PartidoNormalizado[];
  actualizado: string | null;
}

/**
 * Partidos de un torneo: cuadro (todas las rondas), orden de juego (programados con hora y pista)
 * y resultados con estadísticas (para el histórico reciente).
 */
export async function partidosTorneoWta(
  t: TorneoApi,
  tv: TorneoVivo,
  registro: Registro,
  opciones: { ttl: number; conEstadisticas: boolean; actividad: (id: string) => number },
): Promise<ResultadoTorneoWta> {
  const d = await descargarJson<{ matches: PartidoApi[]; lastUpdated?: string }>(
    `${API}/tournaments/${t.tournamentGroup.id}/${t.year}/matches`,
    { ttl: opciones.ttl },
  );
  const partidosVivos: PartidoVivo[] = [];
  const terminados: PartidoNormalizado[] = [];
  const sup = tv.superficie ?? 'dura';
  const formato = formatoDe({ circuito: tv.circuito, categoria: tv.categoria, nombreTorneo: tv.nombre });
  for (const p of d.matches ?? []) {
    if (p.DrawMatchType !== 'S') continue;
    const jA = p.PlayerIDA
      ? registro.resolver(FUENTE_WTA, p.PlayerIDA, `${p.PlayerNameFirstA} ${p.PlayerNameLastA}`, p.PlayerCountryA, 'F', opciones.actividad)
      : null;
    const jB = p.PlayerIDB
      ? registro.resolver(FUENTE_WTA, p.PlayerIDB, `${p.PlayerNameFirstB} ${p.PlayerNameLastB}`, p.PlayerCountryB, 'F', opciones.actividad)
      : null;
    const w = Number(p.Winner);
    const ganador = p.MatchState === 'F' && w >= 2 ? (w % 2 === 0 ? 'a' : 'b') : null;
    const wo = /w\/?o|walkover/i.test(`${p.ScoreString} ${p.ResultString}`);
    const r = ronda(p, t.singlesDrawSize);
    const estado = p.MatchState === 'F' ? 'terminado' : p.MatchState === 'U' ? 'programado' : 'en juego';
    partidosVivos.push({
      id: `${tv.id}-${p.MatchID}`,
      torneoId: tv.id,
      fase: p.DrawLevelType === 'Q' ? 'Q' : 'M',
      ronda: r,
      orden: Number(String(p.MatchID).replace(/\D/g, '')) || 0,
      a: { id: jA?.id ?? null, nombre: jA?.nombre ?? 'Por determinar', pais: p.PlayerCountryA ?? '', semilla: p.SeedA || undefined, entrada: p.EntryTypeA || undefined },
      b: { id: jB?.id ?? null, nombre: jB?.nombre ?? 'Por determinar', pais: p.PlayerCountryB ?? '', semilla: p.SeedB || undefined, entrada: p.EntryTypeB || undefined },
      estado,
      hora: p.MatchTimeStamp ? new Date(p.MatchTimeStamp).toISOString() : null,
      noAntesDe: /not before/i.test(p.NotBeforeText ?? p.NotBefore ?? ''),
      pista: p.CourtName ?? null,
      marcador: p.ScoreString || null,
      ganador,
    });
    if (ganador && jA && jB && !wo) {
      const ganaA = ganador === 'a';
      let stats: { w: number[]; l: number[] } | null = null;
      if (opciones.conEstadisticas) stats = await estadisticasWta(t, p.MatchID, ganaA);
      const fechaPartido = p.MatchTimeStamp ? p.MatchTimeStamp.slice(0, 10) : tv.inicio;
      terminados.push({
        id: `w:${tv.id}:${p.MatchID}`,
        fecha: dias(fechaPartido) + 0.5,
        pool: 'F',
        circuito: tv.circuito,
        nivel: tv.categoria,
        torneo: tv.nombre,
        sup,
        mejorDe: formato.mejorDe,
        ganador: ganaA ? jA.id : jB.id,
        perdedor: ganaA ? jB.id : jA.id,
        marcador: marcadorGanador(p, ganaA),
        ronda: r,
        retirada: w === 4 || w === 5,
        wo: false,
        w: stats?.w ?? null,
        l: stats?.l ?? null,
        fuente: FUENTE_WTA,
      });
    }
  }
  return { partidosVivos, terminados, actualizado: d.lastUpdated ?? null };
}

async function estadisticasWta(t: TorneoApi, matchId: string, ganaA: boolean): Promise<{ w: number[]; l: number[] } | null> {
  try {
    const s = await descargarJson<StatsApi[]>(`${API}/tournaments/${t.tournamentGroup.id}/${t.year}/matches/${matchId}/stats`, { ttl: Infinity });
    const tot = s.find((x) => x.setnum === 0);
    if (!tot || !tot.totservplayeda || !tot.totservplayedb) return null;
    const lado = (x: 'a' | 'b'): number[] => {
      const o = x === 'a' ? 'b' : 'a';
      const svpt = tot[`totservplayed${x}`];
      const in1 = tot[`ptsplayed1stserv${x}`];
      const won1 = tot[`ptswon1stserv${x}`];
      const won2 = tot[`ptstotwonserv${x}`] - won1;
      const bpf = tot[`breakptsplayed${o}`];
      const bps = bpf - tot[`breakptsconv${o}`];
      return [tot[`aces${x}`], tot[`dblflt${x}`], svpt, in1, won1, won2, tot[`servgamesplayed${x}`], bps, bpf];
    };
    const a = lado('a');
    const b = lado('b');
    const valido = (v: number[]) => v[2] > 0 && v[3] <= v[2] && v[4] <= v[3] && v[5] >= 0 && v[5] <= v[2] - v[3] && v[7] >= 0 && v[7] <= v[8];
    if (!valido(a) || !valido(b)) return null;
    return ganaA ? { w: a, l: b } : { w: b, l: a };
  } catch {
    return null;
  }
}

export async function rankingWta(paginas = 15): Promise<{ id: string; nombre: string; pais: string; nacimiento: string | null; pos: number; puntos: number; fecha: string }[]> {
  const res: { id: string; nombre: string; pais: string; nacimiento: string | null; pos: number; puntos: number; fecha: string }[] = [];
  for (let page = 0; page < paginas; page++) {
    const d = await descargarJson<
      { player: { id: number; fullName: string; countryCode: string; dateOfBirth: string }; ranking: number; points: number; rankedAt: string }[]
    >(`${API}/players/ranked?page=${page}&pageSize=100&type=rankSingles&sort=asc&metric=SINGLES`, { ttl: 12 * 3600 });
    for (const r of d) {
      res.push({
        id: String(r.player.id),
        nombre: r.player.fullName,
        pais: r.player.countryCode,
        nacimiento: r.player.dateOfBirth ?? null,
        pos: r.ranking,
        puntos: r.points,
        fecha: r.rankedAt.slice(0, 10),
      });
    }
    if (d.length < 100) break;
  }
  return res;
}
