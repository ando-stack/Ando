import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { rowsToSnapshot, snapshotToRows } from '../ingest/lib/supabase-map';
import { fixtureSnapshot } from './fixture';
import type { CompetitionSnapshot } from '../engine/snapshot';

function check(snap: CompetitionSnapshot) {
  const rows = snapshotToRows(snap);
  // Simula el paso por JSON (PostgREST devuelve JSON)
  const back = rowsToSnapshot(snap.comp, JSON.parse(JSON.stringify(rows)));
  expect(back.teams.length).toBe(snap.teams.length);
  expect(back.players.length).toBe(snap.players.length);
  for (const t of snap.teams) {
    const b = back.teams.find((x) => x.id === t.id)!;
    expect(b.blended).toEqual(t.blended);
    expect(b.quarters.for.map((x) => +x.toFixed(9))).toEqual(t.quarters.for.map((x) => +x.toFixed(9)));
  }
  for (const p of snap.players) {
    const b = back.players.find((x) => x.id === p.id)!;
    expect(b.rates).toEqual(p.rates);
    expect(b.quarterShare).toEqual(p.quarterShare);
    expect(b.teamId).toBe(p.teamId);
  }
  for (const r of snap.rotations) {
    const b = back.rotations.find((x) => x.teamId === r.teamId)!;
    expect(b.players.reduce((a, p) => a + p.minutes, 0)).toBeCloseTo(r.players.reduce((a, p) => a + p.minutes, 0), 6);
  }
  expect(back.lineups.map((l) => l.starters)).toEqual(snap.lineups.map((l) => l.starters));
  expect(back.league).toEqual(snap.league);
}

describe('mapeo snapshot ↔ tablas de Supabase', () => {
  it('ida y vuelta sin pérdida (fixture)', () => check(fixtureSnapshot()));
  for (const c of ['nba', 'euroleague', 'acb'])
    it.skipIf(!existsSync(`data/snapshot/${c}.json`))(`ida y vuelta sin pérdida (${c})`, () => check(JSON.parse(readFileSync(`data/snapshot/${c}.json`, 'utf8'))));
});
