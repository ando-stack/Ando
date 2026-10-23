/**
 * Motor de simulación posesión a posesión y jugador a jugador.
 * El modelo completo se describe en docs/modelo.md.
 *
 * Garantías de coherencia (comprobadas en los tests):
 *  - Todas las estadísticas de equipo son la suma de las de sus jugadores.
 *  - Los puntos por periodo suman el resultado final.
 *  - En cada instante hay exactamente 5 jugadores por equipo en pista, así que los segundos
 *    jugados suman 5 × duración total del partido (incluidas las prórrogas).
 */
import { Rng } from './rng';
import { N_STATS, ST, type GameResult, type SimGameInput, type SimPlayer, type SimTeam } from './types';

const MAX_OT = 12;

export function simulateGame(input: SimGameInput, rng: Rng): GameResult {
  const { rules, params: P } = input;
  const teams: [SimTeam, SimTeam] = [input.home, input.away];
  const np = [teams[0].players.length, teams[1].players.length];
  const stats = [new Float64Array(np[0] * N_STATS), new Float64Array(np[1] * N_STATS)];
  const periods: [number[], number[]] = [[], []];
  const score = [0, 0];
  const poss = [0, 0];
  const foulLimit = rules.faltasEliminacion;
  const regLen = rules.duracionPeriodo;
  const regSec = rules.periodos * regLen;

  // ---- Ritmo del partido
  const gamePace =
    ((teams[0].pace * teams[1].pace) / input.leaguePace) * P.paceFactor * Math.max(0.85, 1 + P.paceSd * rng.normal());
  const avgPossDur = regSec / (2 * gamePace);

  // ---- Objetivos de minutos de cada jugador (con variabilidad por partido)
  // target[t][i*5+q] = segundos objetivo en el periodo q (0..3) y en cada prórroga (4)
  const target = [new Float64Array(np[0] * 5), new Float64Array(np[1] * 5)];
  const playedQ = [new Float64Array(np[0] * 5), new Float64Array(np[1] * 5)];
  for (let t = 0; t < 2; t++) {
    const pl = teams[t].players;
    const noisy = new Float64Array(np[t]);
    let sum = 0;
    for (let i = 0; i < np[t]; i++) {
      const sd = pl[i].minutes >= 20 ? P.minutesSd : P.minutesSd * 2;
      noisy[i] = pl[i].minutes * Math.exp(sd * rng.normal() - (sd * sd) / 2);
      sum += noisy[i];
    }
    const k = sum > 0 ? (5 * regSec) / 60 / sum : 0;
    for (let q = 0; q < 4; q++) {
      let qs = 0;
      for (let i = 0; i < np[t]; i++) qs += noisy[i] * k * 60 * pl[i].qShare[q];
      const kq = qs > 0 ? (5 * regLen) / qs : 0;
      for (let i = 0; i < np[t]; i++) target[t][i * 5 + q] = noisy[i] * k * 60 * pl[i].qShare[q] * kq;
    }
    // Prórroga: proporcional al último cuarto
    let q4 = 0;
    for (let i = 0; i < np[t]; i++) q4 += target[t][i * 5 + 3];
    for (let i = 0; i < np[t]; i++)
      target[t][i * 5 + 4] = q4 > 0 ? (target[t][i * 5 + 3] / q4) * 5 * rules.duracionProrroga : 0;
  }

  // ---- Uso de cada jugador en este partido (variabilidad por partido)
  const usageW = [new Float64Array(np[0]), new Float64Array(np[1])];
  for (let t = 0; t < 2; t++)
    for (let i = 0; i < np[t]; i++) {
      const sd = P.usageSd ?? 0;
      usageW[t][i] = teams[t].players[i].usage * (sd > 0 ? Math.exp(sd * rng.normal() - (sd * sd) / 2) : 1);
    }

  // ---- Estado
  const onCourt = [new Int32Array(5), new Int32Array(5)];
  const isOn = [new Uint8Array(np[0]), new Uint8Array(np[1])];
  const out = [new Uint8Array(np[0]), new Uint8Array(np[1])];
  const teamFouls = [0, 0];
  const last2Fouls = [0, 0];
  let period = 0;
  let len = regLen;
  let rem = regLen;

  const inc = (t: number, i: number, k: number, v = 1) => {
    if (i >= 0) stats[t][i * N_STATS + k] += v;
  };
  const addPoints = (t: number, pts: number) => {
    score[t] += pts;
    periods[t][period] += pts;
  };

  let marginAt60: number | undefined;
  const tick = (dur: number) => {
    if (dur <= 0) return;
    if (marginAt60 === undefined && period === rules.periodos - 1 && rem - dur < 60) marginAt60 = score[0] - score[1];
    const qi = period < 4 ? period : 4;
    for (let t = 0; t < 2; t++) {
      const oc = onCourt[t];
      for (let j = 0; j < 5; j++) {
        const i = oc[j];
        if (i < 0) continue;
        stats[t][i * N_STATS + ST.SEC] += dur;
        playedQ[t][i * 5 + qi] += dur;
      }
    }
    rem -= dur;
  };

  // Elige un jugador en pista ponderando por una tasa
  const wbuf = new Float64Array(5);
  const pickOn = (t: number, w: (p: SimPlayer) => number, exclude = -1): number => {
    const oc = onCourt[t];
    const pl = teams[t].players;
    for (let j = 0; j < 5; j++) wbuf[j] = oc[j] >= 0 && oc[j] !== exclude ? w(pl[oc[j]]) : 0;
    const j = rng.weighted(wbuf, 5);
    return j < 0 ? -1 : oc[j];
  };
  const sumOn = (t: number, w: (p: SimPlayer) => number) => {
    let x = 0;
    const oc = onCourt[t];
    for (let j = 0; j < 5; j++) if (oc[j] >= 0) x += w(teams[t].players[oc[j]]);
    return x;
  };

  // ---- Rotaciones
  const troubleLimit = (pf: number, q: number) => {
    if (q === 0) return pf >= 2;
    if (q === 1) return pf >= 3;
    if (q === 2) return pf >= foulLimit - 1;
    return pf >= foulLimit - 1 && rem > 0.5 * len;
  };
  const needs = new Float64Array(Math.max(np[0], np[1], 5));
  const top = new Int32Array(5);
  const doSubs = (t: number, periodStart = false) => {
    const pl = teams[t].players;
    const n = np[t];
    const qi = period < 4 ? period : 4;
    const margin = Math.abs(score[0] - score[1]);
    const garbage = period >= 3 && rem < 0.4 * len && margin >= P.garbageMargin;
    let avail = 0;
    for (let i = 0; i < n; i++) if (!out[t][i]) avail++;
    for (let i = 0; i < n; i++) {
      if (out[t][i] && avail >= 5) {
        needs[i] = -1e9;
        continue;
      }
      let need = (target[t][i * 5 + qi] - playedQ[t][i * 5 + qi]) / Math.max(rem, 5);
      if (target[t][i * 5 + qi] <= 0) need -= 1;
      const pf = stats[t][i * N_STATS + ST.PF];
      if (troubleLimit(pf, qi)) need *= need > 0 ? 0.3 : 1.5;
      if (garbage) need += pl[i].minutes >= 24 ? -0.6 : 0.3;
      if (!periodStart && isOn[t][i]) need += 0.12; // histéresis: evita cambios continuos
      if (out[t][i]) need -= 100; // eliminado, pero el equipo no tiene 5 disponibles
      needs[i] = need;
    }
    if (periodStart && (period === 0 || period === 2)) {
      // Titulares designados al inicio del 1.er y 3.er cuarto: se les da prioridad máxima
      for (let i = 0; i < n; i++) if (pl[i].starter && !out[t][i]) needs[i] += 1000;
    }
    // Selección directa de los 5 con mayor necesidad (n <= 15, sin ordenar arrays)
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const v = needs[i];
      if (cnt < 5) {
        let j = cnt++;
        while (j > 0 && needs[top[j - 1]] < v) {
          top[j] = top[j - 1];
          j--;
        }
        top[j] = i;
      } else if (v > needs[top[4]]) {
        let j = 4;
        while (j > 0 && needs[top[j - 1]] < v) {
          top[j] = top[j - 1];
          j--;
        }
        top[j] = i;
      }
    }
    const oc = onCourt[t];
    const on = isOn[t];
    let changed = false;
    for (let j = 0; j < 5; j++) {
      const i = j < cnt ? top[j] : -1;
      if (i >= 0 && !on[i]) changed = true;
    }
    if (!changed && !periodStart) return;
    on.fill(0);
    for (let j = 0; j < 5; j++) {
      const i = j < cnt ? top[j] : -1;
      oc[j] = i;
      if (i >= 0) on[i] = 1;
    }
  };

  // ---- Faltas
  const isOT = () => period >= rules.periodos;
  const inPenalty = (d: number) => {
    if (rules.faltaPermitidaUltimosDosMinutos) {
      const limit = isOT() ? rules.faltasEquipoSinPenalizacionProrroga : rules.faltasEquipoSinPenalizacion;
      return teamFouls[d] >= limit || (rem <= 120 && last2Fouls[d] >= 1);
    }
    return teamFouls[d] >= rules.faltasEquipoSinPenalizacion;
  };
  let needSubCheck = false;
  const personalFoul = (t: number, i: number, offensive: boolean) => {
    // Un jugador ya eliminado que sigue en pista por falta de sustitutos no suma más faltas
    // personales (en la NBA se castigan como técnicas al equipo).
    if (i >= 0 && stats[t][i * N_STATS + ST.PF] < foulLimit) inc(t, i, ST.PF);
    if (!offensive || rules.faltaAtaqueCuentaEquipo) {
      teamFouls[t]++;
      if (rem <= 120) last2Fouls[t]++;
    }
    if (i >= 0 && stats[t][i * N_STATS + ST.PF] >= foulLimit && !out[t][i]) {
      out[t][i] = 1;
      doSubs(t); // la falta detiene el juego: el eliminado sale inmediatamente
    }
  };

  const freeThrows = (t: number, i: number, n: number): boolean => {
    const p = Math.min(0.99, teams[t].players[i].ft * P.ftFactor);
    let last = false;
    for (let k = 0; k < n; k++) {
      inc(t, i, ST.FTA);
      last = rng.next() < p;
      if (last) {
        inc(t, i, ST.FTM);
        inc(t, i, ST.PTS);
        addPoints(t, 1);
      }
    }
    return last;
  };

  const orebProb = (o: number, d: number, afterFt: boolean) => {
    const O = teams[o];
    const D = teams[d];
    const a = O.orebPct;
    const b = 1 - D.drebPct;
    const L = 0.5 * (a + b) || 0.28;
    // combinación tipo log5 de lo que coge el ataque y lo que concede la defensa
    const num = (a * b) / L;
    const den = num + ((1 - a) * (1 - b)) / (1 - L);
    let p = num / den;
    const rO = sumOn(o, (x) => x.oreb) / (O.avgOnCourt.oreb || 1);
    const rD = sumOn(d, (x) => x.dreb) / (D.avgOnCourt.dreb || 1);
    let odds = (p / (1 - p)) * Math.sqrt(rO / Math.max(rD, 0.2)) * P.orebFactor;
    if (afterFt) odds *= P.ftOrebFactor;
    p = odds / (1 + odds);
    return p;
  };

  /** Acredita un rebote a un jugador, salvo que sea rebote de equipo. */
  const creditReb = (t: number, k: number) => {
    if (rng.next() < P.teamReboundShare) return;
    inc(t, pickOn(t, k === ST.OREB ? (x) => x.oreb : (x) => x.dreb), k);
  };

  // ---- Contexto de final de partido
  const late = () => period >= rules.periodos - 1;
  // Ventaja de campo y forma del día de cada equipo (acierto correlacionado dentro del partido)
  const form = [Math.exp((P.gameFormSd ?? 0) * rng.normal()), Math.exp((P.gameFormSd ?? 0) * rng.normal())];
  const shootEdge = [(1 + P.homeShootingEdge / 2) * form[0], (1 - P.homeShootingEdge / 2) * form[1]];

  /** Juega una posesión del equipo o. Devuelve true si el siguiente ataque es en transición. */
  const possession = (o: number): boolean => {
    const d = 1 - o;
    const O = teams[o];
    const D = teams[d];
    poss[o]++;
    let segment = 0;
    let fast = transitionNext;
    for (let guard = 0; guard < 40; guard++) {
      if (rem <= 0.3) {
        tick(rem);
        return false;
      }
      const margin = score[o] - score[d]; // > 0: ataca el que gana
      const isLate = late() && rem <= 120;
      // Faltas intencionadas del equipo que pierde
      if (late() && rem <= rules.ventanaFaltasIntencionadas && margin > 0) {
        // Perdiendo de 1-2: hay que hacer falta solo si el rival puede agotar el reloj (quedan
        // menos segundos que el reloj de posesión). De 3: casi nunca (se defiende el triple),
        // salvo en los últimos segundos. De 4 a 9: falta cuanto mayor es la diferencia, antes.
        const deficit = margin;
        const W = rules.ventanaFaltasIntencionadas;
        const wants =
          (deficit <= 2 && rem <= rules.relojPosesion - 2) ||
          (deficit === 3 && rem <= 8 && rng.next() < 0.4) ||
          (deficit >= 4 && deficit <= 6 && rem <= 0.6 * W) ||
          (deficit >= 7 && deficit <= 9 && rem <= W);
        const foul = wants && rng.next() < 0.85;
        if (foul) {
          tick(Math.min(rem, 1.5 + rng.next() * 3));
          const fouler = pickOn(d, (x) => x.pf);
          const fouled = pickOn(o, (x) => x.usage * (1.25 - x.ft));
          if (fouler < 0 || fouled < 0) return false;
          const pen = inPenalty(d);
          personalFoul(d, fouler, false);
          inc(o, fouled, ST.PFD);
          if (pen) {
            const made = freeThrows(o, fouled, 2);
            if (!made) {
              if (rng.next() < orebProb(o, d, true)) {
                creditReb(o, ST.OREB);
                segment = 1;
                continue;
              }
              creditReb(d, ST.DREB);
            }
            subsBoth();
            return false;
          }
          subsBoth();
          segment = 1;
          continue;
        }
      }
      // Duración de la jugada
      let mean = segment === 0 ? avgPossDur : avgPossDur * 0.55;
      if (fast) mean *= 0.6;
      if (isLate && margin > 0) mean = Math.max(mean, 18); // agotar posesión
      if (isLate && margin < 0) mean *= rem <= 60 ? P.lateMinuteHurry ?? 0.4 : 0.6; // prisa (en el último minuto, ataques muy rápidos)
      const cap = segment === 0 ? rules.relojPosesion : rules.relojTrasReboteOfensivo;
      let dur = Math.min(cap, Math.max(1.5, rng.erlang(3, mean)));
      // Último tiro: empate o perdiendo por 1-3 con el reloj por debajo del de posesión
      if (late() && margin <= 0 && margin >= -3 && rem <= rules.relojPosesion) dur = Math.max(0.5, rem - 1 - rng.next() * 2);
      let buzzer = false;
      if (dur >= rem) {
        if (rem < 1) {
          tick(rem);
          return false;
        }
        dur = rem - 0.3;
        buzzer = true;
      }
      tick(dur);
      fast = false;

      // Falta personal no de tiro
      const pNsf = P.nonShootingFoulRate * (sumOn(d, (x) => x.pf) / (D.avgOnCourt.pf || 1));
      if (!buzzer && rng.next() < pNsf) {
        const fouler = pickOn(d, (x) => x.pf);
        const fouled = pickOn(o, (x) => x.pfd);
        const pen = inPenalty(d);
        personalFoul(d, fouler, false);
        inc(o, fouled, ST.PFD);
        if (pen) {
          const made = freeThrows(o, fouled, 2);
          if (!made) {
            if (rng.next() < orebProb(o, d, true)) {
              creditReb(o, ST.OREB);
              subsBoth();
              segment = 1;
              continue;
            }
            creditReb(d, ST.DREB);
          }
          subsBoth();
          return false;
        }
        subsBoth();
        segment = 1;
        continue;
      }

      // Jugador que termina la posesión y tipo de acción
      // Jugador que termina la posesión: ponderado por su uso en este partido
      const ocO = onCourt[o];
      for (let j = 0; j < 5; j++) wbuf[j] = ocO[j] >= 0 ? usageW[o][ocO[j]] : 0;
      const jSh = rng.weighted(wbuf, 5);
      const sh = jSh < 0 ? -1 : ocO[jSh];
      if (sh < 0) return false;
      const S = O.players[sh];
      let wT = S.pTov * D.defTov * P.tovFactor;
      let wF = S.pTrip * D.defTrip * P.tripFactor;
      let w2 = S.p2;
      let w3 = S.p3 * D.defThreeShare;
      if (late() && rem <= 30 && margin === -3) {
        w3 *= 5;
        w2 *= 0.4;
      } else if (late() && rem <= 60 && margin <= -3 && margin >= -6) {
        w3 *= P.lateThreeBoost ?? 2.5; // perdiendo de 3-6 en el último minuto: se buscan triples
      } else if (late() && rem <= 24 && (margin === -2 || margin === -1)) {
        w2 *= 1.8; // buscar el empate / la canasta segura
        wT *= 0.7;
      } else if (late() && rem <= 60 && margin <= -4) w3 *= 1.6;
      if (buzzer) {
        wT *= 0.5;
        wF *= 0.5;
      }
      const tot = wT + wF + w2 + w3;
      const r = rng.next() * tot;
      if (r < wT) {
        // Pérdida
        inc(o, sh, ST.TOV);
        if (rng.next() < P.offensiveFoulShare) {
          personalFoul(o, sh, true);
          const drawer = pickOn(d, (x) => x.pfd);
          if (drawer >= 0) inc(d, drawer, ST.PFD);
          subsBoth();
          return false;
        }
        const rS = sumOn(d, (x) => x.stl) / (D.avgOnCourt.stl || 1);
        if (rng.next() < Math.min(0.95, D.stealShare * P.stlFactor * Math.sqrt(rS))) {
          inc(d, pickOn(d, (x) => x.stl), ST.STL);
          return true; // robo: contraataque
        }
        subsBoth();
        return false;
      }
      if (r < wT + wF) {
        // Falta en el tiro sin canasta: viaje a la línea
        const fouler = pickOn(d, (x) => x.pf);
        personalFoul(d, fouler, false);
        inc(o, sh, ST.PFD);
        const n = rng.next() < P.threeShotTripShare ? 3 : 2;
        const made = freeThrows(o, sh, n);
        if (!made) {
          if (rng.next() < orebProb(o, d, true)) {
            creditReb(o, ST.OREB);
            subsBoth();
            segment = 1;
            continue;
          }
          creditReb(d, ST.DREB);
        }
        subsBoth();
        return false;
      }
      // Tiro de campo
      const three = r >= wT + wF + w2;
      const base = three ? S.fg3 * D.defFg3 * P.fg3Factor : S.fg2 * D.defFg2 * P.fg2Factor;
      // Desviación respecto a la ventaja esperada a estas alturas del partido
      const elapsedFrac = period < rules.periodos ? (period * regLen + (regLen - rem)) / regSec : 1;
      const expLead = (o === 0 ? 1 : -1) * (input.expectedMargin ?? 0) * elapsedFrac;
      const lead = Math.max(-25, Math.min(25, margin - expLead));
      const pMake = Math.min(0.95, base * shootEdge[o] * (1 - (P.scoreEffect * lead) / 10) * (buzzer ? 0.6 : 1));
      inc(o, sh, three ? ST.FG3A : ST.FG2A);
      if (rng.next() < pMake) {
        inc(o, sh, three ? ST.FG3M : ST.FG2M);
        inc(o, sh, ST.PTS, three ? 3 : 2);
        addPoints(o, three ? 3 : 2);
        // Asistencia
        const s3 = O.fg3mShare;
        const baseAst = O.astPerFgm / (0.85 * (1 - s3) + 1.35 * s3);
        const rA = sumOn(o, (x) => x.ast) / (O.avgOnCourt.ast || 1);
        const pAst = Math.min(0.97, baseAst * (three ? 1.35 : 0.85) * P.astFactor * Math.sqrt(rA));
        if (rng.next() < pAst) {
          const a = pickOn(o, (x) => x.ast, sh);
          if (a >= 0) inc(o, a, ST.AST);
        }
        // 2+1 / 3+1
        if (rng.next() < P.andOneRate) {
          const fouler = pickOn(d, (x) => x.pf);
          personalFoul(d, fouler, false);
          inc(o, sh, ST.PFD);
          const made = freeThrows(o, sh, 1);
          if (!made) {
            if (rng.next() < orebProb(o, d, true)) {
              creditReb(o, ST.OREB);
              subsBoth();
              segment = 1;
              continue;
            }
            creditReb(d, ST.DREB);
          }
          subsBoth();
          return false;
        }
        if (rng.next() < 0.5 || needSubCheck) subsBoth();
        return false;
      }
      // Fallo: posible tapón (solo en tiros de 2) y rebote
      if (!three) {
        const rB = sumOn(d, (x) => x.blk) / (D.avgOnCourt.blk || 1);
        if (rng.next() < Math.min(0.5, D.blockPerMiss2 * P.blkFactor * Math.sqrt(rB))) {
          const b = pickOn(d, (x) => x.blk);
          if (b >= 0) inc(d, b, ST.BLK);
        }
      }
      if (rng.next() < orebProb(o, d, false)) {
        creditReb(o, ST.OREB);
        segment = 1;
        continue;
      }
      creditReb(d, ST.DREB);
      return rng.next() < 0.2;
    }
    return false;
  };

  const subsBoth = () => {
    needSubCheck = false;
    doSubs(0);
    doSubs(1);
  };

  // ---- Partido
  let transitionNext = false;
  const jumpWinner = rng.next() < 0.5 ? 0 : 1;
  for (period = 0; period < rules.periodos + MAX_OT; period++) {
    if (period >= rules.periodos && score[0] !== score[1]) break;
    len = period < rules.periodos ? regLen : rules.duracionProrroga;
    rem = len;
    periods[0].push(0);
    periods[1].push(0);
    if (!(isOT() && rules.prorrogaAcumulaCuartoCuarto)) {
      teamFouls[0] = 0;
      teamFouls[1] = 0;
    }
    last2Fouls[0] = 0;
    last2Fouls[1] = 0;
    doSubs(0, true);
    doSubs(1, true);
    // Saque inicial de cada periodo (salto en el 1.º y en las prórrogas; alterno en el resto)
    let o: number;
    if (period === 0 || isOT()) o = rng.next() < 0.5 ? 0 : 1;
    else if (rules.faltaPermitidaUltimosDosMinutos) o = period === 3 ? jumpWinner : 1 - jumpWinner; // NBA
    else o = period % 2 === 1 ? 1 - jumpWinner : jumpWinner; // FIBA: flecha alterna
    transitionNext = false;
    while (rem > 0.3) {
      transitionNext = possession(o);
      if (needSubCheck) subsBoth();
      o = 1 - o;
    }
    if (rem > 0) tick(rem);
  }
  return {
    homePeriods: periods[0],
    awayPeriods: periods[1],
    homeStats: stats[0],
    awayStats: stats[1],
    possessions: [poss[0], poss[1]],
    marginAt60,
  };
}
