import crypto from "node:crypto";
import { getConfig } from "../core/config.ts";
import { getDb, now } from "../core/db.ts";
import { usedTopicKeys } from "../core/project.ts";
import type { Category, Fact, Idea } from "../core/types.ts";
import { isStale, loadFacts } from "./factbank.ts";
import { HOOKS, fill, usedPhrases } from "./phrases.ts";

export const CHARACTERS: Record<string, string> = {
  jason: "Jason",
  lucia: "Lucia",
  cal: "Cal",
  brian: "Brian Heder",
  boobie: "Boobie Ike",
  raul: "Raul Bautista",
  "real dimez": "the Real Dimez",
};

function whoOf(f: Fact): string | undefined {
  const k = f.keywords[0];
  return CHARACTERS[k];
}

/** Take facts in order while the narration still fits the word budget (hook/context/payoff need ~18 words). */
function withinBudget(facts: Fact[], max = 3): Fact[] {
  const budget = getConfig().script.maxWords - 18;
  const out: Fact[] = [];
  let used = 0;
  for (const f of facts) {
    const w = f.line.split(/\s+/).length + 2;
    if (out.length >= max || used + w > budget) continue;
    out.push(f);
    used += w;
  }
  return out;
}

const LISTICLE_TITLES = [
  "3 GTA 6 Details You Probably Missed",
  "3 Hidden Details in GTA 6's Character Bios",
  "GTA 6: 3 Things Rockstar Quietly Revealed",
  "3 GTA 6 Facts Straight From Rockstar",
  "3 Small GTA 6 Details With Big Story Hints",
];

const ideaId = () => "idea-" + crypto.randomBytes(4).toString("hex");

/** Fewer previous uses = better. Counts how many existing projects already used each fact. */
function factUsage(): Map<string, number> {
  const rows = getDb().prepare(`SELECT json FROM ideas WHERE used = 1`).all() as { json: string }[];
  const m = new Map<string, number>();
  for (const r of rows) for (const id of (JSON.parse(r.json) as Idea).factIds) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

function pickHook(format: Idea["format"], vars: Record<string, string | number>, salt: number): string {
  const used = usedPhrases("hook");
  const all = HOOKS[format].map((h) => fill(h, vars));
  const fresh = all.filter((h) => !used.has(h));
  const pool = fresh.length ? fresh : all;
  return pool[salt % pool.length];
}

/** Build candidate ideas from the verified fact bank (no API needed). */
export function offlineIdeas(opts: { category?: Category | "any"; count?: number; seed?: number } = {}): Idea[] {
  const facts = loadFacts().filter((f) => !isStale(f));
  const usage = factUsage();
  const usedTopics = usedTopicKeys();
  const seed = opts.seed ?? Date.now();
  const out: Idea[] = [];
  const confirmed = facts.filter((f) => f.label === "CONFIRMED_FACT");
  const byUse = (a: Fact, b: Fact) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0);

  // Listicles: 3 confirmed details with 3 distinct topics/characters.
  const detailPool = confirmed.filter((f) => ["secrets", "characters"].includes(f.category)).sort(byUse);
  for (let start = 0; start < detailPool.length; start++) {
    const chosen: Fact[] = [];
    const topics = new Set<string>();
    const whos = new Set<string>();
    for (let i = 0; i < detailPool.length && chosen.length < 3; i++) {
      const f = detailPool[(start + i) % detailPool.length];
      const w = whoOf(f) ?? f.topic;
      if (topics.has(f.topic) || whos.has(w)) continue;
      chosen.push(f);
      topics.add(f.topic);
      whos.add(w);
    }
    if (chosen.length < 3) continue;
    // Keep room for hook + context + payoff inside the word budget.
    const mainWords = chosen.reduce((n, f) => n + f.line.split(/\s+/).length + 2, 0);
    if (mainWords > getConfig().script.maxWords - 18) continue;
    const topicKey = "listicle:" + chosen.map((f) => f.id).sort().join("+");
    if (out.some((o) => o.topicKey === topicKey)) continue;
    out.push({
      id: ideaId(),
      title: LISTICLE_TITLES[out.filter((o) => o.format === "listicle").length % LISTICLE_TITLES.length],
      category: "secrets",
      format: "listicle",
      hook: pickHook("listicle", { n: 3 }, seed + start),
      angle: "Three lesser-known details from Rockstar's official character bios: " + chosen.map((f) => whoOf(f) ?? f.topic).join(", "),
      factIds: chosen.map((f) => f.id),
      labels: ["CONFIRMED_FACT"],
      topicKey,
      writer: "offline",
      createdAt: now(),
    });
  }

  // Character deep dives.
  const groups = new Map<string, Fact[]>();
  for (const f of confirmed) {
    const w = whoOf(f);
    if (w) groups.set(w, [...(groups.get(w) ?? []), f]);
  }
  for (const [who, fs] of groups) {
    if (fs.length < 2) continue;
    const pick = withinBudget(fs.sort(byUse));
    if (pick.length < 2) continue;
    out.push({
      id: ideaId(),
      title: `What Rockstar Revealed About ${who.replace(/^the /, "The ")}`,
      category: "characters",
      format: "deep-dive",
      hook: pickHook("deep-dive", { who }, seed + out.length),
      angle: `Character breakdown of ${who} using only Rockstar's official bio.`,
      factIds: pick.map((f) => f.id),
      labels: ["CONFIRMED_FACT"],
      topicKey: "deep:" + who.toLowerCase(),
      writer: "offline",
      createdAt: now(),
    });
  }

  // Theories: confirmed anchor + clearly-labelled theory/speculation.
  for (const t of facts.filter((f) => f.label === "THEORY" || f.label === "SPECULATION")) {
    const anchor = confirmed.find((c) => c.keywords.some((k) => t.keywords.includes(k)));
    if (!anchor) continue;
    out.push({
      id: ideaId(),
      title: t.label === "THEORY" ? `The GTA 6 ${t.keywords[0][0].toUpperCase() + t.keywords[0].slice(1)} Theory` : `A GTA 6 Detail Fans Are Speculating About`,
      category: "theories",
      format: "theory",
      hook: pickHook("theory", {}, seed + out.length),
      angle: `${anchor.claim} → ${t.label.toLowerCase()}: ${t.claim}`,
      factIds: [anchor.id, t.id],
      labels: ["CONFIRMED_FACT", t.label],
      topicKey: "theory:" + t.id,
      writer: "offline",
      createdAt: now(),
    });
  }

  // News roundup (only while the time-sensitive facts are fresh).
  const news = confirmed.filter((f) => f.category === "news");
  if (news.length >= 2) {
    out.push({
      id: ideaId(),
      title: "GTA 6: What's Officially Confirmed Right Now",
      category: "news",
      format: "news",
      hook: pickHook("news", {}, seed),
      angle: "Launch status straight from Rockstar: date, platforms, pre-load.",
      factIds: withinBudget(news).map((f) => f.id),
      labels: ["CONFIRMED_FACT"],
      topicKey: "news:" + new Date().toISOString().slice(0, 10),
      writer: "offline",
      createdAt: now(),
    });
  }

  const filtered = out
    .filter((i) => !opts.category || opts.category === "any" || i.category === opts.category)
    .filter((i) => !usedTopics.has(i.topicKey));
  // Rank: least-used facts first.
  const cost = (i: Idea) => i.factIds.reduce((s, id) => s + (usage.get(id) ?? 0), 0);
  filtered.sort((a, b) => cost(a) - cost(b));
  // Round-robin across formats so a request returns a varied mix, not ten listicles.
  const byFormat = new Map<string, Idea[]>();
  for (const i of filtered) byFormat.set(i.format, [...(byFormat.get(i.format) ?? []), i]);
  const mixed: Idea[] = [];
  while (mixed.length < filtered.length) for (const list of byFormat.values()) if (list.length) mixed.push(list.shift()!);
  return mixed.slice(0, opts.count ?? 10);
}

export function saveIdeas(ideas: Idea[]) {
  const st = getDb().prepare(`INSERT OR REPLACE INTO ideas (id, json, used, created_at) VALUES (?, ?, 0, ?)`);
  for (const i of ideas) st.run(i.id, JSON.stringify(i), i.createdAt);
}

export function getIdea(id: string): Idea | null {
  const row = getDb().prepare(`SELECT json FROM ideas WHERE id = ?`).get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Idea) : null;
}

export function listIdeas(includeUsed = false): (Idea & { used: boolean })[] {
  const rows = getDb()
    .prepare(`SELECT json, used FROM ideas ${includeUsed ? "" : "WHERE used = 0"} ORDER BY created_at DESC LIMIT 200`)
    .all() as { json: string; used: number }[];
  return rows.map((r) => ({ ...(JSON.parse(r.json) as Idea), used: Boolean(r.used) }));
}
