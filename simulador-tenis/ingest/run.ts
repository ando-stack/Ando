/**
 * Ingesta completa:  npm run ingesta          (histórico + vivo + perfiles + Elo + publicación)
 *                    npm run ingesta:vivo     (sólo torneos/cuadros/órdenes de juego; usa la caché)
 *
 * Salida: public/data/*.json (snapshot que sirve la web) y, si hay credenciales en el entorno,
 * Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, sólo en el servidor de ingesta).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Superficie } from '../config/formatos';
import { ratingCombinado } from '../engine/elo';
import { I, type ClaveSuperficie, type ParamsModelo, type PerfilJugador, type Pool } from '../engine/modelo';
import { AcumuladorPerfiles } from '../engine/perfiles';
import type { EntradaIndice, EstadoFuente, FichaJugador, MetaDatos, PartidoHistorial } from '../src/lib/tiposDatos';
import { ajustarPriors, ajustarRankingElo, cargarCalibracion, construirParams, mediasDesde } from './ajuste';
import { FUENTE_ESPN, rankingAtpEspn } from './fuentes/espn';
import { FUENTE_SACKMANN, cargarSackmann } from './fuentes/sackmann';
import { FUENTE_WTA, rankingWta } from './fuentes/wta';
import { guardarHistorico, validarHistorico } from './historico';
import { DIR_PUBLICO, publicar } from './publicar';
import { Registro } from './lib/registro';
import { claveNombre, dias, fechaDeDias, hoyDias, log } from './lib/util';
import { sincronizarSupabase } from './supabase';
import { cargarVivo } from './vivo';

const soloVivo = process.argv.includes('--solo-vivo');
const INICIO_ELO = 2020;
const INICIO_STATS = '2023-01-01';
/** Palabras que no identifican un torneo (para el respaldo de superficie por nombre). */
const GENERICAS = new Set(['open', 'masters', 'championships', 'international', 'tennis', 'grand', 'prix', 'trophy', 'classic', 'cup', 'finals', 'indoors', 'rolex', 'bank', 'erste']);

async function main() {
  const t0 = Date.now();
  const hoy = hoyDias();
  const anio = new Date().getUTCFullYear();
  const registro = new Registro();
  const fuentes: EstadoFuente[] = [];
  const avisos: string[] = [];

  // 1) Histórico Sackmann
  const fS: EstadoFuente = {
    fuente: FUENTE_SACKMANN,
    descripcion: 'Jeff Sackmann, tennis_atp / tennis_wta (CC BY-NC-SA 4.0), espejo de archivo en Hugging Face',
    ok: true,
    ultimoIntento: new Date().toISOString(),
    ultimoExito: null,
    registros: 0,
  };
  fuentes.push(fS);
  const sack = await cargarSackmann(registro, { desde: INICIO_ELO, hasta: anio, desdeFutures: anio - 4 });
  fS.registros = sack.partidos.length;
  fS.ultimoExito = new Date().toISOString();
  log('Sackmann', sack.partidos.length, 'partidos', sack.fechaMaxima);

  // Actividad (para desempatar homónimos) y superficie por ciudad/torneo (respaldo para ATP).
  const actividadMap = new Map<string, number>();
  const supPorToken = new Map<string, Superficie>();
  for (const m of sack.partidos) {
    if (m.fecha >= hoy - 730) {
      actividadMap.set(m.ganador, (actividadMap.get(m.ganador) ?? 0) + 1);
      actividadMap.set(m.perdedor, (actividadMap.get(m.perdedor) ?? 0) + 1);
    }
    if (m.circuito === 'ATP' && m.fecha >= hoy - 800)
      for (const t of claveNombre(m.torneo).split(' ')) if (t.length > 3 && !GENERICAS.has(t)) supPorToken.set(t, m.sup);
  }
  const actividad = (id: string) => actividadMap.get(id) ?? 0;
  const superficiePorHistorico = (nombre: string, ciudad: string) => {
    for (const t of claveNombre(`${ciudad} ${nombre}`).split(' ')) if (supPorToken.has(t)) return supPorToken.get(t)!;
    return null;
  };

  // 2) Fuentes en vivo y resultados recientes
  const maxDe = (k: string) => dias(sack.fechaMaxima[k] ?? `${anio}0101`) + 6;
  const vivo = await cargarVivo(registro, {
    desdeReciente: { ATP: maxDe('M-ATP'), CH: maxDe('M-CH'), WTA: maxDe('F-WTA'), W125: maxDe('F-W125') },
    diasFuturo: 14,
    actividad,
    superficiePorHistorico,
    soloVivo,
  });
  fuentes.push(...vivo.fuentes);
  for (const f of vivo.fuentes) if (!f.ok) avisos.push(`Fuente ${f.fuente} con errores: ${f.error}. Se usan los últimos datos válidos.`);

  // 3) Histórico validado
  const { partidos, informe } = validarHistorico([...sack.partidos, ...vivo.recientes]);
  log('Histórico validado', partidos.length, informe.descartados);
  guardarHistorico(partidos);

  // 4) Parámetros: medias (3 últimas temporadas) + calibración guardada
  const desdeStats = dias(INICIO_STATS);
  const medias = mediasDesde(partidos, desdeStats, hoy + 1);
  let M: ParamsModelo = construirParams(cargarCalibracion(), medias);

  // Dos pasadas: la primera estima los priors por Elo; la segunda calcula los perfiles finales.
  const acumular = (params: ParamsModelo) => {
    const acc = new AcumuladorPerfiles(params);
    const eloMensual = new Map<string, Map<string, number>>();
    for (const m of partidos) {
      acc.anadir(m, { stats: m.fecha >= desdeStats });
      if (m.fecha >= hoy - 1100) {
        const mes = fechaDeDias(Math.floor(m.fecha)).slice(0, 7);
        for (const id of [m.ganador, m.perdedor]) {
          let h = eloMensual.get(id);
          if (!h) eloMensual.set(id, (h = new Map()));
          h.set(mes, Math.round(acc.elo.get(id).g));
        }
      }
    }
    return { acc, eloMensual };
  };
  const pasada1 = acumular(M);
  M = { ...M, prior: ajustarPriors(pasada1.acc, M, hoy) };
  const { acc, eloMensual } = acumular(M);
  log('Perfiles calculados', acc.datos.size, 'jugadores; priors', JSON.stringify(M.prior));

  // 5) Rankings: histórico Sackmann + actuales (WTA API, ESPN top 150)
  const rankingActual = new Map<string, { pos: number; puntos: number | null; fecha: string; fuente: string }>();
  const historialRanking = new Map<string, [string, number][]>();
  for (const r of sack.rankings) {
    const h = historialRanking.get(r.id) ?? [];
    h.push([r.fecha, r.pos]);
    historialRanking.set(r.id, h);
    const prev = rankingActual.get(r.id);
    if (!prev || prev.fecha < r.fecha) rankingActual.set(r.id, { pos: r.pos, puntos: r.puntos, fecha: r.fecha, fuente: 'Sackmann' });
  }
  // Un ranking del histórico de hace meses no es "actual" si la fuente en vivo lo cubre.
  const fRW: EstadoFuente = { fuente: 'wta-ranking', descripcion: 'Ranking WTA actual (api.wtatennis.com)', ok: true, ultimoIntento: new Date().toISOString(), ultimoExito: null, registros: 0 };
  try {
    const rw = await rankingWta();
    for (const r of rw) {
      const j = registro.resolver(FUENTE_WTA, r.id, r.nombre, r.pais, 'F', actividad, { nacimiento: r.nacimiento });
      rankingActual.set(j.id, { pos: r.pos, puntos: r.puntos, fecha: r.fecha, fuente: 'WTA' });
      const h = historialRanking.get(j.id) ?? [];
      h.push([r.fecha, r.pos]);
      historialRanking.set(j.id, h);
    }
    fRW.registros = rw.length;
    fRW.ultimoExito = new Date().toISOString();
  } catch (e) {
    fRW.ok = false;
    fRW.error = (e as Error).message;
  }
  fuentes.push(fRW);
  const fRA: EstadoFuente = { fuente: 'espn-ranking', descripcion: 'Ranking ATP actual, top 150 (ESPN)', ok: true, ultimoIntento: new Date().toISOString(), ultimoExito: null, registros: 0 };
  try {
    const ra = await rankingAtpEspn();
    const fecha = fechaDeDias(hoy);
    for (const r of ra) {
      const j = registro.resolver(FUENTE_ESPN, r.idEspn, r.nombre, null, 'M', actividad);
      rankingActual.set(j.id, { pos: r.pos, puntos: r.puntos, fecha, fuente: 'ATP vía ESPN' });
      const h = historialRanking.get(j.id) ?? [];
      h.push([fecha, r.pos]);
      historialRanking.set(j.id, h);
    }
    fRA.registros = ra.length;
    fRA.ultimoExito = new Date().toISOString();
  } catch (e) {
    fRA.ok = false;
    fRA.error = (e as Error).message;
  }
  fuentes.push(fRA);

  // 6) Jugadores publicados: activos en los últimos 18 meses o presentes en cuadros actuales.
  const enCuadros = new Set<string>();
  for (const d of vivo.detalles) for (const p of d.partidos) for (const id of [p.a.id, p.b.id]) if (id) enCuadros.add(id);
  const rankElo = { M: ajustarRankingElo(new Map([...rankingActual].map(([k, v]) => [k, v.pos])), acc, 'M'), F: ajustarRankingElo(new Map([...rankingActual].map(([k, v]) => [k, v.pos])), acc, 'F') };
  log('Ranking→Elo', JSON.stringify(rankElo));

  const historialPorJugador = new Map<string, PartidoHistorial[]>();
  const desdeHist = hoy - 3 * 365;
  for (const m of partidos) {
    if (m.fecha < desdeHist || m.circuito === 'ITF' || m.circuito === 'OTRO') continue;
    const fecha = fechaDeDias(Math.floor(m.fecha));
    for (const [yo, rival, g] of [
      [m.ganador, m.perdedor, 1],
      [m.perdedor, m.ganador, 0],
    ] as const) {
      const l = historialPorJugador.get(yo) ?? [];
      l.push({ f: fecha, t: m.torneo, c: m.circuito, s: m.sup, r: m.ronda, o: rival, on: registro.get(rival)?.nombre ?? rival, g, m: m.marcador });
      historialPorJugador.set(yo, l);
    }
  }

  const indice: EntradaIndice[] = [];
  const fichas = new Map<string, FichaJugador>();
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const [id, a] of acc.datos) {
    const reg = registro.get(id);
    if (!reg) continue;
    const activo = a.ultimo >= hoy - 548;
    if (!activo && !enCuadros.has(id)) continue;
    const circ = acc.circuitoPrincipal(id, hoy) ?? 'ITF';
    // Jugadores sólo de ITF/futures sin estadísticas ni ranking: fuera, salvo que estén en un cuadro.
    const rk = rankingActual.get(id);
    if (circ === 'ITF' && !enCuadros.has(id) && a.nReal.todas === 0 && (!rk || rk.pos > 1000)) continue;
    const pool = reg.pool as Pool;
    const elo = structuredClone(acc.elo.get(id));
    let eloEstimado = false;
    if (elo.n < 5 && rk) {
      const e = rankElo[pool].a + rankElo[pool].b * Math.log(rk.pos);
      const w = elo.n / 5;
      elo.g = w * elo.g + (1 - w) * e;
      for (const s of ['dura', 'tierra', 'hierba'] as const) elo.s[s] = w * elo.s[s] + (1 - w) * e;
      eloEstimado = true;
    }
    const perfilAcc = acc.perfil(id, hoy, pool);
    const stats = Object.fromEntries(
      (Object.keys(perfilAcc.stats) as ClaveSuperficie[]).map((k) => [k, perfilAcc.stats[k].map(r2)]),
    ) as Record<ClaveSuperficie, number[]>;
    const perfil: PerfilJugador = {
      id,
      nombre: reg.nombre,
      pais: reg.pais,
      pool,
      circuito: circ as PerfilJugador['circuito'],
      nacimiento: reg.nacimiento,
      mano: reg.mano,
      reves: null,
      altura: reg.altura,
      ranking: rk ? { pos: rk.pos, puntos: rk.puntos, fecha: rk.fecha, fuente: rk.fuente } : null,
      elo: {
        g: Math.round(elo.g),
        n: elo.n,
        s: { dura: Math.round(elo.s.dura), tierra: Math.round(elo.s.tierra), hierba: Math.round(elo.s.hierba) },
        ns: elo.ns,
        ultimo: elo.ultimo,
      },
      forma: r2(perfilAcc.forma),
      stats,
      nReal: perfilAcc.nReal,
      nPartidos: a.nPartidos,
      ultimoPartido: a.ultimo ? fechaDeDias(Math.floor(a.ultimo)) : null,
    };
    if (eloEstimado) (perfil as PerfilJugador & { eloEstimado?: boolean }).eloEstimado = true;
    indice.push({
      id,
      nombre: reg.nombre,
      pais: reg.pais,
      pool,
      circuito: circ,
      rank: rk?.pos ?? null,
      elo: Math.round(ratingCombinado(elo, 'dura', 0)),
      nReal: perfilAcc.nReal.todas,
      activo: perfil.ultimoPartido,
    });
    const rkHist = (historialRanking.get(id) ?? []).sort((x, y) => x[0].localeCompare(y[0]));
    // Ranking: una muestra cada ~4 semanas para aligerar.
    const rkMuestreo = rkHist.filter((_, i) => i % 4 === 0 || i === rkHist.length - 1);
    fichas.set(id, {
      perfil,
      partidos: (historialPorJugador.get(id) ?? []).slice(-150).reverse(),
      rankings: rkMuestreo,
      eloHistorico: [...(eloMensual.get(id) ?? new Map()).entries()],
    });
  }
  // Jugadores que aparecen en cuadros pero no en el histórico (debutantes): perfil estimado.
  for (const id of enCuadros) {
    if (fichas.has(id)) continue;
    const reg = registro.get(id);
    if (!reg) continue;
    const pool = reg.pool as Pool;
    const rk = rankingActual.get(id);
    const e = rk ? rankElo[pool].a + rankElo[pool].b * Math.log(rk.pos) : 1500;
    const vacio = new Array(Object.keys(I).length).fill(0);
    const perfil: PerfilJugador & { eloEstimado?: boolean } = {
      id,
      nombre: reg.nombre,
      pais: reg.pais,
      pool,
      circuito: pool === 'M' ? 'CH' : 'W125',
      nacimiento: reg.nacimiento,
      mano: reg.mano,
      reves: null,
      altura: reg.altura,
      ranking: rk ?? null,
      elo: { g: Math.round(e), n: 0, s: { dura: Math.round(e), tierra: Math.round(e), hierba: Math.round(e) }, ns: { dura: 0, tierra: 0, hierba: 0 }, ultimo: 0 },
      forma: 0,
      stats: { todas: vacio, dura: vacio, tierra: vacio, hierba: vacio },
      nReal: { todas: 0, dura: 0, tierra: 0, hierba: 0 },
      nPartidos: 0,
      ultimoPartido: null,
      eloEstimado: true,
    };
    indice.push({ id, nombre: reg.nombre, pais: reg.pais, pool, circuito: perfil.circuito, rank: rk?.pos ?? null, elo: Math.round(e), nReal: 0, activo: null });
    fichas.set(id, { perfil, partidos: [], rankings: rk ? [[rk.fecha, rk.pos]] : [], eloHistorico: [] });
  }
  indice.sort((x, y) => (x.rank ?? 99999) - (y.rank ?? 99999) || y.elo - x.elo);
  log('Jugadores publicados', indice.length);
  if (registro.nuevos.length) log('Jugadores sin emparejar con el histórico:', registro.nuevos.length, registro.nuevos.slice(0, 15).join('; '));

  // 7) Publicación
  const conStats = partidos.filter((m) => m.w).length;
  const hasta: Record<string, string> = { ...Object.fromEntries(Object.entries(sack.fechaMaxima).map(([k, v]) => [k, `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`])) };
  for (const m of vivo.recientes) {
    const k = `${m.pool}-${m.circuito}`;
    const f = fechaDeDias(Math.floor(m.fecha));
    if (!hasta[k] || hasta[k] < f) hasta[k] = f;
  }
  const meta: MetaDatos = {
    generado: new Date().toISOString(),
    fuentes,
    historico: { desde: `${INICIO_ELO}-01-01`, hasta, partidos: partidos.length, conEstadisticas: conStats },
    avisos,
  };
  M = { ...M, ajustadoEl: M.ajustadoEl || new Date().toISOString() };
  const previoTorneos = join(DIR_PUBLICO, 'torneos.json');
  const hayTorneosPrevios = existsSync(previoTorneos);
  if (!vivo.torneos.length && hayTorneosPrevios) {
    avisos.push('Ninguna fuente en vivo respondió: se mantienen los torneos de la última actualización válida.');
    log('Sin torneos nuevos; se conservan los anteriores', JSON.parse(readFileSync(previoTorneos, 'utf8')).length);
  }
  publicar({ meta, modelo: M, torneos: vivo.torneos, detalles: vivo.detalles, indice, fichas, conservarTorneos: !vivo.torneos.length });
  await sincronizarSupabase({ meta, torneos: vivo.torneos, detalles: vivo.detalles, fichas, partidos, rankingActual });
  log(`Ingesta terminada en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
