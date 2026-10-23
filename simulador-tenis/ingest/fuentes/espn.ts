/**
 * ESPN (site.api.espn.com): marcadores, cuadros y orden de juego del circuito ATP.
 * Es la API que usa espn.com; no está documentada públicamente para terceros. Uso personal/no
 * comercial, con caché y ≥ 400 ms entre peticiones. No incluye Challenger ni estadísticas de saque.
 */
import { formatoDe, type Superficie } from '../../config/formatos';
import type { PartidoNormalizado } from '../../engine/perfiles';
import type { PartidoVivo, TorneoVivo } from '../../src/lib/tiposDatos';
import { descargarJson } from '../lib/http';
import type { Registro } from '../lib/registro';
import { dias } from '../lib/util';

const API = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
export const FUENTE_ESPN = 'espn';

interface Competidor {
  id: string;
  order: number;
  winner?: boolean;
  curatedRank?: { current: number };
  linescores?: { value: number; tiebreak?: number; winner?: boolean }[];
  athlete?: { displayName: string; flag?: { href?: string; alt?: string } };
}

interface Competicion {
  id: string;
  date: string;
  status: { type: { name: string; state: string; completed: boolean } };
  round?: { displayName: string };
  venue?: { court?: string };
  competitors: Competidor[];
  notes?: { text: string }[];
}

export interface EventoEspn {
  id: string;
  name: string;
  date: string;
  endDate: string;
  major?: boolean;
  venue?: { displayName?: string };
  groupings?: { grouping: { slug: string }; competitions: Competicion[] }[];
}

export async function eventosEspn(liga: 'atp' | 'wta', fecha: string, ttl: number): Promise<EventoEspn[]> {
  const d = await descargarJson<{ events?: EventoEspn[] }>(`${API}/${liga}/scoreboard?dates=${fecha.replace(/-/g, '')}`, { ttl });
  return (d.events ?? []).filter((e) => e.groupings?.length);
}

const paisDeBandera = (c: Competidor) => (c.athlete?.flag?.href?.match(/\/([a-z]{3})\.png/)?.[1] ?? '').toUpperCase();

function rondaEspn(nombre: string, tamCuadro: number, maxQ: number): { fase: 'Q' | 'M'; ronda: string } {
  const n = nombre.toLowerCase();
  if (n.startsWith('qualifying')) {
    if (n.includes('final')) return { fase: 'Q', ronda: `Q${maxQ + 1}` };
    const k = Number(n.match(/(\d)/)?.[1] ?? 1);
    return { fase: 'Q', ronda: `Q${k}` };
  }
  if (n.includes('quarter')) return { fase: 'M', ronda: 'QF' };
  if (n.includes('semi')) return { fase: 'M', ronda: 'SF' };
  if (n === 'final') return { fase: 'M', ronda: 'F' };
  const k = Number(n.match(/(\d+)/)?.[1] ?? 1);
  return { fase: 'M', ronda: `R${Math.max(8, tamCuadro / 2 ** (k - 1))}` };
}

export interface InfoTorneoAtp {
  superficie: Superficie | null;
  cubierta: boolean | null;
  categoria: string;
  fuente: string;
}

/** Convierte un evento ESPN en torneo + partidos (cuadro, orden de juego y resultados). */
export function procesarEventoEspn(
  e: EventoEspn,
  info: InfoTorneoAtp,
  registro: Registro,
  actividad: (id: string) => number,
  actualizado: string,
  hoy: string,
): { torneo: TorneoVivo; partidos: PartidoVivo[]; terminados: PartidoNormalizado[] } {
  const comps = (e.groupings ?? []).filter((g) => g.grouping.slug === 'mens-singles').flatMap((g) => g.competitions);
  const r1 = comps.filter((c) => /^round 1$/i.test(c.round?.displayName ?? '')).length;
  const tam = r1 ? 2 ** Math.ceil(Math.log2(r1 * 2)) : 32;
  const maxQ = Math.max(0, ...comps.map((c) => Number((c.round?.displayName ?? '').match(/^Qualifying (\d)/)?.[1] ?? 0)));
  const inicio = e.date.slice(0, 10);
  const fin = new Date(new Date(e.endDate).getTime() - 3600_000 * 6).toISOString().slice(0, 10);
  const categoria = e.major ? 'Grand Slam' : info.categoria;
  const formato = formatoDe({ circuito: 'ATP', categoria, nombreTorneo: e.name });
  const formatoQ = formatoDe({ circuito: 'ATP', categoria, nombreTorneo: e.name, esCuadroFinal: false });
  const [ciudad, pais] = (e.venue?.displayName ?? '').split(',').map((s) => s.trim());
  const torneo: TorneoVivo = {
    id: `espn-${e.id}`,
    circuito: 'ATP',
    categoria,
    nombre: e.name,
    ciudad: ciudad ?? '',
    pais: pais ?? '',
    inicio,
    fin,
    superficie: info.superficie,
    cubierta: info.cubierta,
    formatoId: formato.id,
    formatoQualyId: formatoQ.id,
    estado: fin < hoy ? 'terminado' : inicio > hoy ? 'próximo' : 'en curso',
    fuente: `ESPN (cuadros y horarios)${info.fuente ? ` + ${info.fuente} (superficie/categoría)` : ''}`,
    actualizado,
    nPartidos: 0,
    tieneOrdenDeJuego: true,
    avisos: info.superficie ? [] : ['Superficie no confirmada por ninguna fuente: revisa el selector antes de simular.'],
  };
  const partidos: PartidoVivo[] = [];
  const terminados: PartidoNormalizado[] = [];
  for (const c of comps) {
    const [ca, cb] = [...c.competitors].sort((x, y) => x.order - y.order);
    if (!ca || !cb) continue;
    const lado = (x: Competidor) => {
      const nombre = x.athlete?.displayName ?? 'TBD';
      if (!x.athlete || /^tbd$/i.test(nombre)) return { j: null, nombre: 'Por determinar', pais: '' };
      const pais = paisDeBandera(x);
      return { j: registro.resolver(FUENTE_ESPN, x.id, nombre, pais, 'M', actividad), nombre, pais };
    };
    const A = lado(ca);
    const B = lado(cb);
    const { fase, ronda } = rondaEspn(c.round?.displayName ?? '', tam, maxQ);
    const st = c.status.type;
    const estado: PartidoVivo['estado'] = st.state === 'pre' ? 'programado' : st.state === 'in' ? 'en juego' : 'terminado';
    const ganador = ca.winner ? 'a' : cb.winner ? 'b' : null;
    const sets = (ca.linescores ?? []).map((l, i) => ({ a: l.value, b: cb.linescores?.[i]?.value ?? 0, tbA: l.tiebreak, tbB: cb.linescores?.[i]?.tiebreak }));
    const textoSets = sets.map((s) => `${s.a}-${s.b}${s.tbA !== undefined && s.tbB !== undefined ? `(${Math.min(s.tbA, s.tbB)})` : ''}`).join(' ');
    partidos.push({
      id: `${torneo.id}-${c.id}`,
      torneoId: torneo.id,
      fase,
      ronda,
      orden: Number(c.id) || 0,
      a: { id: A.j?.id ?? null, nombre: A.j?.nombre ?? A.nombre, pais: A.pais, semilla: ca.curatedRank ? String(ca.curatedRank.current) : undefined },
      b: { id: B.j?.id ?? null, nombre: B.j?.nombre ?? B.nombre, pais: B.pais, semilla: cb.curatedRank ? String(cb.curatedRank.current) : undefined },
      estado,
      hora: st.state === 'pre' && c.date ? new Date(c.date).toISOString() : c.date ? new Date(c.date).toISOString() : null,
      noAntesDe: false,
      pista: c.venue?.court ?? null,
      marcador: textoSets || null,
      ganador,
    });
    if (estado === 'terminado' && ganador && A.j && B.j && st.name !== 'STATUS_WALKOVER') {
      const ganaA = ganador === 'a';
      const marcador =
        sets
          .map((s) => {
            const [x, y] = ganaA ? [s.a, s.b] : [s.b, s.a];
            const tb = s.tbA !== undefined && s.tbB !== undefined ? `(${Math.min(s.tbA, s.tbB)})` : '';
            return `${x}-${y}${tb}`;
          })
          .join(' ') + (st.name === 'STATUS_RETIRED' ? ' RET' : '');
      terminados.push({
        id: `e:${e.id}:${c.id}`,
        fecha: dias(c.date.slice(0, 10)) + 0.5,
        pool: 'M',
        circuito: 'ATP',
        nivel: categoria,
        torneo: e.name,
        sup: info.superficie ?? 'dura',
        mejorDe: fase === 'M' ? formato.mejorDe : formatoQ.mejorDe,
        ganador: ganaA ? A.j.id : B.j.id,
        perdedor: ganaA ? B.j.id : A.j.id,
        marcador,
        ronda,
        retirada: st.name === 'STATUS_RETIRED',
        wo: false,
        w: null,
        l: null,
        fuente: FUENTE_ESPN,
      });
    }
  }
  torneo.nPartidos = partidos.length;
  return { torneo, partidos, terminados };
}

export async function rankingAtpEspn(): Promise<{ idEspn: string; nombre: string; pos: number; puntos: number }[]> {
  const d = await descargarJson<{ rankings?: { ranks: { current: number; points: number; athlete: { id: string; displayName: string } }[] }[] }>(
    `${API}/atp/rankings`,
    { ttl: 12 * 3600 },
  );
  return (d.rankings?.[0]?.ranks ?? []).map((r) => ({ idEspn: r.athlete.id, nombre: r.athlete.displayName, pos: r.current, puntos: r.points }));
}
