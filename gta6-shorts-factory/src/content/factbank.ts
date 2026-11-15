import fs from "node:fs";
import { r } from "../core/config.ts";
import type { Fact } from "../core/types.ts";

let cache: { mtime: number; facts: Fact[] } | null = null;

export function loadFacts(): Fact[] {
  const file = r("data", "fact-bank.json");
  const dfile0 = r("data", "facts-discovered.json");
  const cfile = r("data", "concepts.json");
  const mtime = fs.statSync(file).mtimeMs + (fs.existsSync(dfile0) ? fs.statSync(dfile0).mtimeMs : 0) + (fs.existsSync(cfile) ? fs.statSync(cfile).mtimeMs * 3 : 0);
  if (cache && cache.mtime === mtime) return cache.facts;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { facts: Fact[] };
  // Facts found by optional web research (Claude mode) live in a separate file.
  let discovered: Fact[] = [];
  const dfile = r("data", "facts-discovered.json");
  if (fs.existsSync(dfile)) discovered = (JSON.parse(fs.readFileSync(dfile, "utf8")) as { facts: Fact[] }).facts;
  const all = [...data.facts, ...discovered.filter((d) => !data.facts.some((f) => f.id === d.id)), ...conceptFacts()];
  validateFacts(all);
  cache = { mtime, facts: all };
  return all;
}

export interface ConceptGroup {
  id: string;
  title: string;
  category: Fact["category"];
  format: "concept" | "what-if";
  hook: string;
  payoff?: string;
  anchor?: string;
  keywords: string[];
  beats: (Pick<Fact, "id" | "label" | "line" | "emphasis" | "visual"> & { hedge: string })[];
}

/** Invented content (fan concepts + speculation) from data/concepts.json. Never presented as fact. */
export function loadConceptGroups(): ConceptGroup[] {
  const f = r("data", "concepts.json");
  if (!fs.existsSync(f)) return [];
  return (JSON.parse(fs.readFileSync(f, "utf8")) as { groups: ConceptGroup[] }).groups;
}

function conceptFacts(): Fact[] {
  return loadConceptGroups().flatMap((g) =>
    g.beats.map((b) => ({
      ...b,
      category: g.category,
      claim: `${b.label === "AI_CONCEPT" ? "Fan concept (invented)" : "Speculation (unconfirmed)"}: ${b.line}`,
      keywords: g.keywords,
      topic: g.id,
      sources: [],
      group: g.id,
    })),
  );
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
    if (f.label !== "CONFIRMED_FACT" && !f.hedge)
      throw new Error(`fact-bank: ${f.id} is ${f.label} but has no hedge phrase`);
    if (f.hedge && !f.line.toLowerCase().includes(f.hedge.toLowerCase()))
      throw new Error(`fact-bank: ${f.id} narration line is missing its hedge "${f.hedge}"`);
  }
}

/** True when a time-sensitive fact must be re-checked before use. */
export function isStale(f: Fact, today = new Date()): boolean {
  return Boolean(f.recheckAfter && new Date(f.recheckAfter + "T00:00:00Z") < today);
}
