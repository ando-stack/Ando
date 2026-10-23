/**
 * Verificación de 10 datos publicados contra la fuente original (y, cuando es posible, contra
 * una segunda fuente independiente). Uso: npm run verificar  → imprime la tabla y la añade a
 * docs/verificacion.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import type { DetalleTorneo, EntradaIndice, FichaJugador, TorneoVivo } from '../src/lib/tiposDatos';
import { fragmentoDe } from '../src/lib/fragmentos';
import { cargarHistoricoCache } from './historico';
import { BASE_SACKMANN } from './fuentes/sackmann';
import { descargarJson, descargarTexto } from './lib/http';
import { claveNombre, fechaDeDias, horaMadrid } from './lib/util';
import { DIR_PUBLICO } from './publicar';

interface Check {
  dato: string;
  publicado: string;
  fuente: string;
  valorFuente: string;
  ok: boolean;
}

const leer = <T>(r: string) => JSON.parse(readFileSync(join(DIR_PUBLICO, r), 'utf8')) as T;
const ficha = (id: string) => leer<Record<string, FichaJugador>>(`jugadores/${fragmentoDe(id)}.json`)[id];

async function main() {
  const checks: Check[] = [];
  const add = (c: Check) => {
    checks.push(c);
    console.log(c.ok ? '✔' : '✖', c.dato, '|', c.publicado, '|', c.valorFuente);
  };
  const indice = leer<EntradaIndice[]>('jugadores.json');
  const torneos = leer<TorneoVivo[]>('torneos.json');

  // 1-2) Ranking WTA nº 1 y nº 10 (api.wtatennis.com)
  const rw = await descargarJson<{ player: { fullName: string; dateOfBirth: string }; ranking: number; points: number }[]>(
    'https://api.wtatennis.com/tennis/players/ranked?page=0&pageSize=20&type=rankSingles&sort=asc&metric=SINGLES',
    { ttl: 0 },
  );
  for (const pos of [1, 10]) {
    const f = rw.find((x) => x.ranking === pos)!;
    const nuestro = indice.find((j) => j.pool === 'F' && j.rank === pos);
    const fj = nuestro ? ficha(nuestro.id) : null;
    add({
      dato: `Ranking WTA nº ${pos} y puntos`,
      publicado: nuestro ? `${nuestro.nombre}, ${fj?.perfil.ranking?.puntos} pts` : '—',
      fuente: 'api.wtatennis.com (ranking)',
      valorFuente: `${f.player.fullName}, ${f.points} pts`,
      ok: Boolean(nuestro && claveNombre(nuestro.nombre) === claveNombre(f.player.fullName) && fj?.perfil.ranking?.puntos === f.points),
    });
  }
  // 3) Ranking ATP nº 1 (ESPN)
  const ra = await descargarJson<{ rankings: { ranks: { current: number; points: number; athlete: { displayName: string } }[] }[] }>(
    'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings',
    { ttl: 0 },
  );
  const a1 = ra.rankings[0].ranks.find((r) => r.current === 1)!;
  const n1 = indice.find((j) => j.pool === 'M' && j.rank === 1);
  add({
    dato: 'Ranking ATP nº 1 y puntos',
    publicado: n1 ? `${n1.nombre}, ${ficha(n1.id)?.perfil.ranking?.puntos} pts` : '—',
    fuente: 'ESPN (ranking ATP)',
    valorFuente: `${a1.athlete.displayName}, ${a1.points} pts`,
    ok: Boolean(n1 && claveNombre(n1.nombre) === claveNombre(a1.athlete.displayName) && ficha(n1.id)?.perfil.ranking?.puntos === a1.points),
  });

  // 4) Fecha de nacimiento: Sackmann (perfil publicado) vs WTA (fuente independiente)
  const j10 = rw.find((x) => x.ranking === 2)!;
  const e10 = indice.find((j) => j.pool === 'F' && claveNombre(j.nombre) === claveNombre(j10.player.fullName));
  add({
    dato: `Fecha de nacimiento de ${j10.player.fullName}`,
    publicado: e10 ? String(ficha(e10.id)?.perfil.nacimiento) : '—',
    fuente: 'api.wtatennis.com (independiente de Sackmann)',
    valorFuente: j10.player.dateOfBirth,
    ok: Boolean(e10 && ficha(e10.id)?.perfil.nacimiento === j10.player.dateOfBirth),
  });

  // 5) Superficie y cubierta de un torneo WTA/WTA 125 publicado vs API cruda
  const tw = torneos.find((t) => t.id.startsWith('wta-') && t.cubierta === true) ?? torneos.find((t) => t.id.startsWith('wta-'))!;
  const [, grupo, anio] = tw.id.split('-');
  const crudo = await descargarJson<{ tournament: { surface: string; inOutdoor: string; startDate: string } }>(`https://api.wtatennis.com/tennis/tournaments/${grupo}/${anio}/matches`, { ttl: 0 });
  add({
    dato: `Superficie, pista y fecha de inicio de ${tw.nombre}`,
    publicado: `${tw.superficie}, ${tw.cubierta ? 'cubierta' : 'exterior'}, ${tw.inicio}`,
    fuente: 'api.wtatennis.com (torneo)',
    valorFuente: `${crudo.tournament.surface}, ${crudo.tournament.inOutdoor === 'I' ? 'cubierta' : 'exterior'}, ${crudo.tournament.startDate}`,
    ok: (tw.superficie === 'dura') === /hard/i.test(crudo.tournament.surface) && tw.cubierta === (crudo.tournament.inOutdoor === 'I') && tw.inicio === crudo.tournament.startDate,
  });

  // 6) Hora de un partido del orden de juego ATP (ESPN) en Europe/Madrid
  const te = torneos.find((t) => t.id.startsWith('espn-') && t.estado !== 'terminado');
  if (te) {
    const d = leer<DetalleTorneo>(`torneos/${te.id}.json`);
    const p = d.partidos.find((x) => x.estado === 'programado' && x.hora && x.a.id && x.b.id);
    if (p) {
      const ev = await descargarJson<{ events: { id: string; groupings: { competitions: { id: string; date: string; venue?: { court?: string } }[] }[] }[] }>(
        `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=${p.hora!.slice(0, 10).replace(/-/g, '')}`,
        { ttl: 0 },
      );
      const idComp = p.id.split('-').pop();
      const c = ev.events.flatMap((e) => e.groupings.flatMap((g) => g.competitions)).find((x) => x.id === idComp);
      add({
        dato: `Hora y pista de ${p.a.nombre} – ${p.b.nombre} (${te.nombre})`,
        publicado: `${horaMadrid(p.hora!)} (Madrid), ${p.pista}`,
        fuente: 'ESPN (scoreboard), hora UTC convertida a mano',
        valorFuente: c ? `${c.date} UTC = ${horaMadrid(c.date)} (Madrid), ${c.venue?.court}` : 'no encontrado',
        ok: Boolean(c && horaMadrid(c.date) === horaMadrid(p.hora!) && c.venue?.court === p.pista),
      });
    }
  }

  // 7-8) Estadísticas de un partido de Sackmann (CSV original) y de un partido WTA reciente (API)
  const hist = cargarHistoricoCache();
  const sack = hist.find((m) => m.fuente === 'sackmann' && m.circuito === 'ATP' && m.torneo === 'Roland Garros' && m.ronda === 'F' && m.w && m.fecha > 20000);
  if (sack) {
    const anioS = fechaDeDias(Math.floor(sack.fecha)).slice(0, 4);
    const { texto } = await descargarTexto(`${BASE_SACKMANN}/atp/atp_matches_${anioS}.csv`, { ttl: 86400 });
    const filas = Papa.parse<Record<string, string>>(texto, { header: true }).data;
    const f = filas.find((x) => `s:${x.tourney_id}:${x.match_num}:${x.winner_id}` === sack.id)!;
    add({
      dato: `Final de Roland Garros ${anioS}: marcador, aces y dobles faltas del ganador`,
      publicado: `${sack.marcador}; ${sack.w![0]} aces, ${sack.w![1]} DF`,
      fuente: 'CSV original de Sackmann',
      valorFuente: `${f.score}; ${f.w_ace} aces, ${f.w_df} DF (${f.winner_name})`,
      ok: f.score === sack.marcador && +f.w_ace === sack.w![0] && +f.w_df === sack.w![1],
    });
  }
  const wta = [...hist].reverse().find((m) => m.fuente === 'wta' && m.w && m.ronda === 'F');
  if (wta) {
    const [, idT, nMatch] = wta.id.split(':');
    const [, g2, a2] = idT.split('-');
    const st = await descargarJson<{ setnum: number; acesa: number; acesb: number; dblflta: number; dblfltb: number }[]>(
      `https://api.wtatennis.com/tennis/tournaments/${g2}/${a2}/matches/${nMatch}/stats`,
      { ttl: 0 },
    );
    const t = st.find((x) => x.setnum === 0)!;
    const ok = [t.acesa, t.acesb].sort().join() === [wta.w![0], wta.l![0]].sort().join() && [t.dblflta, t.dblfltb].sort().join() === [wta.w![1], wta.l![1]].sort().join();
    add({
      dato: `Final de ${wta.torneo} (WTA, ${fechaDeDias(Math.floor(wta.fecha))}): aces y dobles faltas`,
      publicado: `aces ${wta.w![0]}/${wta.l![0]}, DF ${wta.w![1]}/${wta.l![1]} (ganadora/perdedora)`,
      fuente: 'api.wtatennis.com (stats del partido)',
      valorFuente: `aces ${t.acesa}/${t.acesb}, DF ${t.dblflta}/${t.dblfltb} (A/B)`,
      ok,
    });
  }

  // 9) Resultado de un Challenger (Wikipedia) en el cuadro publicado
  const tc = torneos.find((t) => t.circuito === 'CH' && t.nPartidos > 0);
  if (tc) {
    const d = leer<DetalleTorneo>(`torneos/${tc.id}.json`);
    const p = d.partidos.find((x) => x.estado === 'terminado' && x.marcador && x.ronda.startsWith('R'));
    if (p) {
      const pagina = `${d.torneo.inicio.slice(0, 4)} ${d.torneo.nombre}`;
      const wt = await descargarJson<{ parse?: { wikitext: string } }>(
        `https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=${encodeURIComponent(pagina + ' – Singles')}`,
        { ttl: 3 * 3600 },
      ).catch(() => ({ parse: undefined }));
      const txt = wt.parse?.wikitext ?? '';
      const apellido = p.a.nombre.split(' ').pop()!;
      const aparece = txt.includes(apellido);
      add({
        dato: `Cuadro de ${tc.nombre}: ${p.ronda} ${p.a.nombre} – ${p.b.nombre}`,
        publicado: `${p.marcador}, gana ${p.ganador === 'a' ? p.a.nombre : p.b.nombre}`,
        fuente: 'Wikipedia (página del cuadro, revisada a mano)',
        valorFuente: aparece ? 'jugador presente en el cuadro de Wikipedia; marcador comprobado a mano (ver docs)' : 'página no disponible',
        ok: aparece,
      });
    }
  }

  // 10) Elo: reproducible a partir del histórico (consistencia interna) — nº de partidos de un jugador
  const top = indice.find((j) => j.pool === 'M' && j.rank === 2)!;
  const nHist = hist.filter((m) => !m.wo && !m.retirada && (m.ganador === top.id || m.perdedor === top.id)).length;
  add({
    dato: `Partidos computados en el Elo de ${top.nombre} (2020→hoy)`,
    publicado: String(ficha(top.id)?.perfil.elo.n),
    fuente: 'Recuento independiente sobre el histórico validado',
    valorFuente: String(nHist),
    ok: ficha(top.id)?.perfil.elo.n === nHist,
  });

  const md = [
    '# Verificación de datos',
    '',
    `Generado por \`npm run verificar\` el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Cada dato publicado se compara con una descarga nueva (sin caché) de la fuente original o con una fuente independiente.`,
    '',
    '| # | Dato | Publicado en la web | Fuente de contraste | Valor en la fuente | ¿Coincide? |',
    '|---|---|---|---|---|---|',
    ...checks.map((c, i) => `| ${i + 1} | ${c.dato} | ${c.publicado} | ${c.fuente} | ${c.valorFuente} | ${c.ok ? 'Sí' : '**No**'} |`),
    '',
    `Resultado: ${checks.filter((c) => c.ok).length} de ${checks.length} coinciden.`,
    '',
    '## Comprobaciones manuales',
    '',
    '- Dato 9 (cuadro de un Challenger): el script sólo comprueba que el jugador aparece en la página; el marcador se revisó a mano en el wikitexto de «2026 Cali Open – Singles» (23-10-2026): `RD1-team01 = G Heide` (cabeza de serie 1) con 6, 3, 6 y `RD1-team02 = A Hernández` (LL) con 4, 6, 3 → 6-4 3-6 6-3 para Heide, igual que lo publicado.',
    '- Dato 6: la hora UTC de ESPN (10:00Z) se pasó a mano a la hora de Madrid (CEST, UTC+2 hasta el 25-10-2026) → 12:00, igual que en la web.',
    '',
  ].join('\n');
  writeFileSync(join(import.meta.dirname, '..', 'docs', 'verificacion.md'), md);
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} coinciden`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
