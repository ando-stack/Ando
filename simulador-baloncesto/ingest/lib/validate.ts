/**
 * Validación de los datos antes de guardarlos: rangos posibles, jugadores existentes,
 * quintetos de 5 jugadores de la plantilla y minutos de rotación coherentes.
 */
import type { CompetitionSnapshot } from '../../engine/snapshot';
import { REGLAS, regulationSeconds } from '../../config/reglas';

export function validateSnapshot(s: CompetitionSnapshot) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const regMin = regulationSeconds(REGLAS[s.comp]) / 60;
  const playerIds = new Set(s.players.map((p) => p.id));
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

  if (s.teams.length < 10) errors.push(`Solo ${s.teams.length} equipos`);
  for (const t of s.teams) {
    const b = t.blended;
    if (!inRange(b.poss, 55, 125)) errors.push(`${t.name}: posesiones fuera de rango (${b.poss})`);
    if (!inRange(b.own.pts, 50, 150)) errors.push(`${t.name}: puntos fuera de rango (${b.own.pts})`);
    for (const k of ['fg2Pct', 'fg3Pct', 'ftPct', 'orebPct', 'drebPct'] as const)
      if (!inRange(b[k], 0.05, 0.99)) errors.push(`${t.name}: ${k} fuera de rango (${b[k]})`);
    const n = s.players.filter((p) => p.teamId === t.id).length;
    if (n < 8) warnings.push(`${t.name}: plantilla con solo ${n} jugadores`);
  }
  for (const p of s.players) {
    if (!s.teams.some((t) => t.id === p.teamId)) errors.push(`Jugador ${p.name} con equipo inexistente ${p.teamId}`);
    if (!inRange(p.mpg, 0, regMin + 25)) errors.push(`${p.name}: minutos por partido fuera de rango (${p.mpg})`);
    for (const k of ['fg2Pct', 'fg3Pct', 'ftPct'] as const)
      if (!inRange(p.rates[k], 0, 1)) errors.push(`${p.name}: ${k} fuera de rango (${p.rates[k]})`);
    for (const [k, v] of Object.entries(p.rates.perMin))
      if (!inRange(v, 0, k === 'min' ? 1 : 3)) errors.push(`${p.name}: tasa ${k} por minuto fuera de rango (${v})`);
    const qs = p.quarterShare.reduce((a, b) => a + b, 0);
    if (Math.abs(qs - 1) > 0.01) errors.push(`${p.name}: reparto por cuartos no suma 1 (${qs})`);
  }
  for (const l of s.lineups) {
    if (l.starters.length !== 5) warnings.push(`Quinteto de ${l.teamId} con ${l.starters.length} jugadores`);
    for (const id of l.starters) if (!playerIds.has(id)) errors.push(`Quinteto de ${l.teamId} con jugador inexistente ${id}`);
  }
  for (const r of s.rotations) {
    const sum = r.players.reduce((a, p) => a + p.minutes, 0);
    if (r.players.length >= 5 && Math.abs(sum - 5 * regMin) > 6)
      warnings.push(`Rotación de ${r.teamId} suma ${sum.toFixed(1)} minutos (esperado ${5 * regMin})`);
  }
  return { errors, warnings };
}
