import fs from "node:fs";
import { r } from "../core/config.ts";
import type { Fact } from "../core/types.ts";

let cache: { mtime: number; facts: Fact[] } | null = null;

export function loadFacts(): Fact[] {
  const file = r("data", "fact-bank.json");
  const dfile0 = r("data", "facts-discovered.json");
  const mtime = fs.statSync(file).mtimeMs + (fs.existsSync(dfile0) ? fs.statSync(dfile0).mtimeMs : 0);
  if (cache && cache.mtime === mtime) return cache.facts;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { facts: Fact[] };
  // Facts found by optional web research (Claude mode) live in a separate file.
  let discovered: Fact[] = [];
  const dfile = r("data", "facts-discovered.json");
  if (fs.existsSync(dfile)) discovered = (JSON.parse(fs.readFileSync(dfile, "utf8")) as { facts: Fact[] }).facts;
  const all = [...data.facts, ...discovered.filter((d) => !data.facts.some((f) => f.id === d.id))];
  validateFacts(all);
  cache = { mtime, facts: all };
  return all;
}

export function factById(id: string): Fact | undefined {
  return loadFacts().find((f) => f.id === id);
}

/** Enforce the bank's own rules so a bad edit is caught on load, not in a published video. */
export function validateFacts(facts: Fact[]) {
  const ids = new Set<string>();
  for (const f of facts) {
    if (ids.has(f.id)) throw new Error(`fact-bank: duplicate id ${f.id}`);
    ids.add(f.id);
    if (f.label === "CONFIRMED_FACT" && !f.sources.some((s) => s.url && s.retrievedAt))
      throw new Error(`fact-bank: ${f.id} is CONFIRMED_FACT but has no dated source`);
    if ((f.label === "THEORY" || f.label === "SPECULATION") && !f.hedge)
      throw new Error(`fact-bank: ${f.id} is ${f.label} but has no hedge phrase`);
    if (f.hedge && !f.line.toLowerCase().includes(f.hedge.toLowerCase()))
      throw new Error(`fact-bank: ${f.id} narration line is missing its hedge "${f.hedge}"`);
  }
}

/** True when a time-sensitive fact must be re-checked before use. */
export function isStale(f: Fact, today = new Date()): boolean {
  return Boolean(f.recheckAfter && new Date(f.recheckAfter + "T00:00:00Z") < today);
}
