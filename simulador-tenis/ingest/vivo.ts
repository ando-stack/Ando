/**
 * Torneos en curso y próximos (ATP, WTA, ATP Challenger, WTA 125) con cuadros y órdenes de juego,
 * y resultados recientes posteriores al histórico de Sackmann.
 */
import { formatoDe, type Superficie } from '../config/formatos';
import type { PartidoNormalizado } from '../engine/perfiles';
import type { DetalleTorneo, EstadoFuente, PartidoVivo, TorneoVivo } from '../src/lib/tiposDatos';
import { eventosEspn, procesarEventoEspn, type EventoEspn, type InfoTorneoAtp } from './fuentes/espn';
import { FUENTE_WIKI, parsearCalendario, parsearCancelados, parsearCuadro, wikitexto, type EntradaCalendario, type PartidoCuadro, type TorneoCancelado } from './fuentes/wikipedia';
import { calendarioWta, partidosTorneoWta, torneoVivoWta } from './fuentes/wta';
import type { Registro } from './lib/registro';
import type { Pool } from '../engine/modelo';
import { claveNombre, dias, fechaDeDias, hoyDias, log } from './lib/util';

export interface ResultadoVivo {
  torneos: TorneoVivo[];
  detalles: DetalleTorneo[];
  recientes: PartidoNormalizado[];
  fuentes: EstadoFuente[];
}

const PALABRAS_GENERICAS = new Set(['open', 'challenger', 'ch', 'cup', 'trophy', 'tennis', 'international', 'internationals', 'championships', 'atp', 'wta', 'tour', 'masters', 'the', 'de', 'di', 'del', 'by', 'ii', 'i', 'iii', 'presented', 'grand', 'prix']);
const tokens = (s: string) => new Set(claveNombre(s).split(' ').filter((t) => t.length > 2 && !PALABRAS_GENERICAS.has(t)));
const coinciden = (a: string, b: string) => {
  const ta = tokens(a);
  for (const t of tokens(b)) if (ta.has(t)) return true;
  return false;
};

function estado(fuente: string, descripcion: string): EstadoFuente {
  return { fuente, descripcion, ok: true, ultimoIntento: new Date().toISOString(), ultimoExito: null, registros: 0 };
}

/** Superficie aproximada de un torneo ATP por su ciudad, usando el histórico (si Wikipedia falla). */
export type BuscadorSuperficie = (nombre: string, ciudad: string) => Superficie | null;

export async function cargarVivo(
  registro: Registro,
  opciones: {
    desdeReciente: { ATP: number; CH: number; WTA: number; W125: number };
    diasFuturo: number;
    actividad: (id: string) => number;
    superficiePorHistorico: BuscadorSuperficie;
    soloVivo?: boolean;
  },
): Promise<ResultadoVivo> {
  const hoy = hoyDias();
  const hoyTxt = fechaDeDias(hoy);
  const ahora = new Date().toISOString();
  const torneos: TorneoVivo[] = [];
  const detalles: DetalleTorneo[] = [];
  const recientes: PartidoNormalizado[] = [];
  const fuentes: EstadoFuente[] = [];
  const ttlSegun = (fin: string) => (dias(fin) < hoy - 3 ? Infinity : 3 * 3600);

  // ---------- Wikipedia: calendarios ATP Tour y Challenger ----------
  const fWiki = estado('wikipedia', 'Wikipedia (CC BY-SA): calendario y cuadros del ATP Challenger Tour, cuadros de WTA 125 sin cuadro en la WTA, torneos cancelados; superficie y categoría del ATP Tour');
  fuentes.push(fWiki);
  const calendarioAtp: EntradaCalendario[] = [];
  const calendarioCh: EntradaCalendario[] = [];
  const calendarioW125: EntradaCalendario[] = [];
  const cancelados: (TorneoCancelado & { circuito: string })[] = [];
  const anios = [...new Set([fechaDeDias(Math.min(opciones.desdeReciente.CH, hoy)).slice(0, 4), hoyTxt.slice(0, 4), fechaDeDias(hoy + opciones.diasFuturo).slice(0, 4)])];
  for (const anio of anios) {
    for (const [pagina, destino] of [
      [`${anio} ATP Tour`, calendarioAtp],
      [`${anio} ATP Challenger Tour`, calendarioCh],
      [`${anio} WTA 125 tournaments`, calendarioW125],
    ] as const) {
      try {
        const txt = await wikitexto(pagina, 6 * 3600);
        if (txt) {
          destino.push(...parsearCalendario(txt, Number(anio)));
          cancelados.push(...parsearCancelados(txt, Number(anio)).map((c) => ({ ...c, circuito: pagina })));
        }
        fWiki.ultimoExito = ahora;
      } catch (e) {
        fWiki.ok = false;
        fWiki.error = `${pagina}: ${(e as Error).message}`;
      }
    }
  }
  fWiki.registros = calendarioAtp.length + calendarioCh.length + calendarioW125.length;
  log('Wikipedia calendarios', calendarioAtp.length, calendarioCh.length, calendarioW125.length, 'cancelados', cancelados.length, fWiki.error ?? '');
  const cancelado = (inicio: string, nombre: string, ciudad: string) =>
    cancelados.find((c) => Math.abs(dias(c.semana) - dias(inicio)) <= 3 && (coinciden(c.nombre, nombre) || coinciden(c.ciudad, ciudad) || coinciden(c.nombre, ciudad)));


  // ---------- WTA y WTA 125 ----------
  const fW = estado('wta', 'api.wtatennis.com: calendario, cuadros, orden de juego, resultados y estadísticas (WTA y WTA 125)');
  fuentes.push(fW);
  try {
    const desde = fechaDeDias(Math.min(opciones.desdeReciente.WTA, opciones.desdeReciente.W125));
    const lista = await calendarioWta(desde, fechaDeDias(hoy + opciones.diasFuturo));
    for (const t of lista) {
      const tv = torneoVivoWta(t, ahora, hoyTxt);
      if (!tv) continue;
      const inicio = dias(t.startDate);
      const fin = dias(t.endDate);
      const esVivo = fin >= hoy - 1 && inicio <= hoy + opciones.diasFuturo;
      const esReciente = !opciones.soloVivo && inicio > opciones.desdeReciente[tv.circuito as 'WTA' | 'W125'] && inicio <= hoy;
      if (!esVivo && !esReciente) continue;
      try {
        const r = await partidosTorneoWta(t, tv, registro, { ttl: ttlSegun(t.endDate), conEstadisticas: esReciente || esVivo, actividad: opciones.actividad });
        fW.registros += r.partidosVivos.length;
        if (esReciente) recientes.push(...r.terminados);
        if (esVivo) {
          const canc = cancelado(tv.inicio, tv.nombre, tv.ciudad);
          if (canc && !r.partidosVivos.length)
            tv.avisos.push(`Wikipedia lo incluye entre los torneos cancelados («${canc.nombre}»), aunque la WTA aún lo lista en su calendario.`);
          if (!r.partidosVivos.length && tv.circuito === 'W125' && !canc) {
            // Respaldo: cuadro de Wikipedia para los WTA 125 sin marcador en directo de la WTA.
            const entrada = calendarioW125.find(
              (c) => Math.abs(dias(c.semana) - dias(tv.inicio)) <= 3 && (coinciden(c.nombre, tv.nombre) || coinciden(c.ciudad, tv.ciudad)),
            );
            if (entrada?.paginaIndividual) {
              try {
                const txt = await wikitexto(entrada.paginaIndividual, 3 * 3600);
                if (txt) {
                  r.partidosVivos.push(...partidosDeCuadro(parsearCuadro(txt), tv, 'F', registro, opciones.actividad));
                  if (r.partidosVivos.length) {
                    tv.fuente = 'WTA (calendario) + Wikipedia (cuadro, mantenido por voluntarios)';
                    tv.avisos.push('Cuadro tomado de Wikipedia: la WTA no publica marcador en directo de este torneo. Sin orden de juego.');
                  }
                }
              } catch {
                /* sin cuadro de respaldo */
              }
            }
          }
          tv.nPartidos = r.partidosVivos.length;
          tv.tieneOrdenDeJuego = r.partidosVivos.some((p) => p.estado !== 'terminado' && p.hora);
          if (!r.partidosVivos.length && !canc) tv.avisos.push('La WTA todavía no ha publicado el cuadro de este torneo.');
          if (r.actualizado) tv.actualizado = r.actualizado;
          torneos.push(tv);
          detalles.push({ torneo: tv, partidos: r.partidosVivos });
        }
      } catch (e) {
        fW.error = `Torneo ${tv.nombre}: ${(e as Error).message}`;
        if (esVivo) {
          tv.avisos.push('No se pudo descargar el cuadro; se muestran los últimos datos válidos si existen.');
          torneos.push(tv);
        }
      }
    }
    fW.ultimoExito = ahora;
  } catch (e) {
    fW.ok = false;
    fW.error = (e as Error).message;
  }
  log('WTA', fW.ok ? 'ok' : fW.error, fW.registros);

  // ---------- ATP: ESPN ----------
  const fE = estado('espn', 'ESPN (site.api.espn.com): cuadros, orden de juego y resultados del ATP Tour');
  fuentes.push(fE);
  try {
    const eventos = new Map<string, { e: EventoEspn; fecha: string }>();
    const inicioBusqueda = opciones.soloVivo ? hoy - 7 : opciones.desdeReciente.ATP + 1;
    for (let d = inicioBusqueda; d <= hoy + opciones.diasFuturo; d += d < hoy - 7 ? 3 : 1) {
      const f = fechaDeDias(d);
      const lista = await eventosEspn('atp', f, d < hoy - 3 ? Infinity : 2 * 3600);
      for (const e of lista) {
        const previo = eventos.get(e.id);
        // Nos quedamos con la consulta más reciente de cada evento (la más actualizada).
        if (!previo || previo.fecha < f) eventos.set(e.id, { e, fecha: f });
      }
    }
    // Para los eventos terminados, la última consulta debe ser posterior a su fin.
    for (const [id, { e, fecha }] of eventos) {
      const fin = e.endDate.slice(0, 10);
      if (fecha < fin && dias(fin) <= hoy) {
        const lista = await eventosEspn('atp', fin, dias(fin) < hoy - 3 ? Infinity : 2 * 3600);
        const act = lista.find((x) => x.id === id);
        if (act) eventos.set(id, { e: act, fecha: fin });
      }
    }
    for (const { e } of eventos.values()) {
      const inicio = dias(e.date.slice(0, 10));
      const info = infoAtp(e, calendarioAtp, opciones.superficiePorHistorico);
      const r = procesarEventoEspn(e, info, registro, opciones.actividad, ahora, hoyTxt);
      fE.registros += r.partidos.length;
      if (!opciones.soloVivo && inicio > opciones.desdeReciente.ATP) recientes.push(...r.terminados);
      const fin = dias(r.torneo.fin);
      if (fin >= hoy - 1 && inicio <= hoy + opciones.diasFuturo) {
        torneos.push(r.torneo);
        detalles.push({ torneo: r.torneo, partidos: r.partidos });
      }
    }
    fE.ultimoExito = ahora;
  } catch (e) {
    fE.ok = false;
    fE.error = (e as Error).message;
  }
  log('ESPN', fE.ok ? 'ok' : fE.error, fE.registros);

  // ---------- ATP Challenger: Wikipedia ----------
  for (const c of calendarioCh) {
    const semana = dias(c.semana);
    const esVivo = semana >= hoy - 7 && semana <= hoy + opciones.diasFuturo;
    const esReciente = !opciones.soloVivo && semana > opciones.desdeReciente.CH && semana <= hoy;
    if (!esVivo && !esReciente) continue;
    if (cancelado(c.semana, c.nombre, c.ciudad)) continue; // Wikipedia lo marca como cancelado
    const id = `wiki-${claveNombre(c.pagina ?? c.nombre).replace(/ /g, '-')}`;
    const inicio = fechaDeDias(semana);
    const fin = fechaDeDias(semana + 6);
    const formato = formatoDe({ circuito: 'CH', nombreTorneo: c.nombre });
    const tv: TorneoVivo = {
      id,
      circuito: 'CH',
      categoria: c.categoria || 'Challenger',
      nombre: c.nombre,
      ciudad: c.ciudad,
      pais: c.pais,
      inicio,
      fin,
      superficie: c.superficie,
      cubierta: c.cubierta,
      formatoId: formato.id,
      formatoQualyId: formato.id,
      estado: fin < hoyTxt ? 'terminado' : inicio > hoyTxt ? 'próximo' : 'en curso',
      fuente: 'Wikipedia (calendario y cuadro, mantenidos por voluntarios)',
      actualizado: ahora,
      nPartidos: 0,
      tieneOrdenDeJuego: false,
      avisos: ['Orden de juego no disponible: la única fuente con horarios de los Challenger (atptour.com) bloquea el acceso automatizado.'],
    };
    let partidos: PartidoVivo[] = [];
    if (c.paginaIndividual) {
      try {
        const txt = await wikitexto(c.paginaIndividual, semana + 6 < hoy - 3 ? Infinity : 3 * 3600);
        if (txt) {
          const cuadro = parsearCuadro(txt);
          const vistos = new Set<string>();
          for (const p of cuadro) {
            const resolver = (j: (typeof p)['a']) =>
              j ? registro.resolver(FUENTE_WIKI, claveNombre(j.nombre).replace(/ /g, '_'), j.nombre, j.pais || null, 'M', opciones.actividad) : null;
            const ja = resolver(p.a);
            const jb = resolver(p.b);
            const clave = `${p.ronda}|${[ja?.id, jb?.id].sort().join('|')}`;
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            const marcador = p.sets.map((s) => `${s.a}-${s.b}${s.tb !== null ? `(${s.tb})` : ''}`).join(' ');
            const terminado = Boolean(p.ganador && (p.sets.length || p.wo));
            partidos.push({
              id: `${id}-${p.orden}`,
              torneoId: id,
              fase: p.fase,
              ronda: p.ronda,
              orden: p.orden,
              a: { id: ja?.id ?? null, nombre: ja?.nombre ?? 'Por determinar', pais: p.a?.pais ?? '', semilla: p.a?.semilla || undefined },
              b: { id: jb?.id ?? null, nombre: jb?.nombre ?? 'Por determinar', pais: p.b?.pais ?? '', semilla: p.b?.semilla || undefined },
              estado: terminado ? 'terminado' : 'programado',
              hora: null,
              noAntesDe: false,
              pista: null,
              marcador: marcador || null,
              ganador: terminado ? p.ganador : null,
            });
            if (esReciente && terminado && !p.wo && p.sets.length && ja && jb && c.superficie) {
              const ganaA = p.ganador === 'a';
              const offset: Record<string, number> = { Q1: -1, Q2: 0, Q3: 0, R64: 1, R48: 1, R32: 1.5, R16: 3, QF: 4, SF: 5, F: 6 };
              recientes.push({
                id: `k:${id}:${p.orden}`,
                fecha: semana + (offset[p.ronda] ?? 2),
                pool: 'M',
                circuito: 'CH',
                nivel: 'C',
                torneo: c.nombre,
                sup: c.superficie,
                mejorDe: 3,
                ganador: ganaA ? ja.id : jb.id,
                perdedor: ganaA ? jb.id : ja.id,
                marcador: p.sets.map((s) => (ganaA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`) + (s.tb !== null ? `(${s.tb})` : '')).join(' ') + (p.retirada ? ' RET' : ''),
                ronda: p.ronda,
                retirada: p.retirada,
                wo: false,
                w: null,
                l: null,
                fuente: FUENTE_WIKI,
              });
            }
          }
        }
      } catch (e) {
        fWiki.error = `${c.paginaIndividual}: ${(e as Error).message}`;
        tv.avisos.push('No se pudo descargar el cuadro de Wikipedia; se reintentará en la próxima actualización.');
      }
    }
    if (!partidos.length) tv.avisos.push('Cuadro todavía no publicado en Wikipedia.');
    partidos = partidos.sort((x, y) => x.orden - y.orden);
    tv.nPartidos = partidos.length;
    if (esVivo) {
      torneos.push(tv);
      detalles.push({ torneo: tv, partidos });
    }
  }
  log('Challenger', calendarioCh.length, 'recientes total', recientes.length);
  for (const f of fuentes) if (f.ok && !f.ultimoExito) f.ultimoExito = ahora;
  return { torneos, detalles, recientes, fuentes };
}

/** Cuadro de Wikipedia → partidos del cuadro (sin horarios). */
function partidosDeCuadro(cuadro: PartidoCuadro[], tv: TorneoVivo, pool: Pool, registro: Registro, actividad: (id: string) => number): PartidoVivo[] {
  const res: PartidoVivo[] = [];
  const vistos = new Set<string>();
  for (const p of cuadro) {
    const resolver = (j: PartidoCuadro['a']) => (j ? registro.resolver(FUENTE_WIKI, claveNombre(j.nombre).replace(/ /g, '_'), j.nombre, j.pais || null, pool, actividad) : null);
    const ja = resolver(p.a);
    const jb = resolver(p.b);
    const clave = `${p.fase}|${p.ronda}|${[ja?.id, jb?.id].sort().join('|')}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const terminado = Boolean(p.ganador && (p.sets.length || p.wo));
    res.push({
      id: `${tv.id}-k${p.orden}`,
      torneoId: tv.id,
      fase: p.fase,
      ronda: p.ronda,
      orden: p.orden,
      a: { id: ja?.id ?? null, nombre: ja?.nombre ?? 'Por determinar', pais: p.a?.pais ?? '', semilla: p.a?.semilla || undefined },
      b: { id: jb?.id ?? null, nombre: jb?.nombre ?? 'Por determinar', pais: p.b?.pais ?? '', semilla: p.b?.semilla || undefined },
      estado: terminado ? 'terminado' : 'programado',
      hora: null,
      noAntesDe: false,
      pista: null,
      marcador: p.sets.map((x) => `${x.a}-${x.b}${x.tb !== null ? `(${x.tb})` : ''}`).join(' ') || null,
      ganador: terminado ? p.ganador : null,
    });
  }
  return res;
}

function infoAtp(e: EventoEspn, cal: EntradaCalendario[], porHistorico: BuscadorSuperficie): InfoTorneoAtp {
  const inicio = dias(e.date.slice(0, 10));
  const ciudad = (e.venue?.displayName ?? '').split(',')[0];
  const candidatos = cal.filter((c) => Math.abs(dias(c.semana) - inicio) <= 9);
  const c =
    candidatos.find((x) => coinciden(x.nombre, e.name) || coinciden(x.ciudad, ciudad) || coinciden(x.ciudad, e.name)) ??
    (candidatos.length === 1 ? candidatos[0] : undefined);
  if (c) return { superficie: c.superficie, cubierta: c.cubierta, categoria: c.categoria || 'ATP', fuente: 'Wikipedia' };
  return { superficie: porHistorico(e.name, ciudad), cubierta: null, categoria: 'ATP', fuente: porHistorico(e.name, ciudad) ? 'histórico de Sackmann' : '' };
}
