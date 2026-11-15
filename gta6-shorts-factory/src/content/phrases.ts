import { getDb } from "../core/db.ts";
import type { Idea } from "../core/types.ts";

// Hook/context/payoff banks for the offline writer. {n} = item count, {who} = character, {place} = region.
// Hooks are short (<= 10 words), concrete and honest: no promise the video can't keep.

export const HOOKS: Record<Idea["format"], string[]> = {
  listicle: [
    "{n} GTA 6 details hiding in plain sight.",
    "You probably missed these {n} GTA 6 details.",
    "{n} things about GTA 6 most fans scrolled past.",
    "Rockstar slipped {n} details into GTA 6 nobody's talking about.",
    "{n} GTA 6 details that change how you see the story.",
    "Here are {n} GTA 6 facts straight from Rockstar.",
  ],
  "deep-dive": [
    "There's more to {who} than the trailers showed.",
    "Everything Rockstar has actually told us about {who}.",
    "{who} might be the most underrated character in GTA 6.",
    "You only know half of {who}'s story.",
    "Rockstar quietly revealed a lot about {who}.",
  ],
  theory: [
    "This GTA 6 theory makes a lot of sense.",
    "Fans think Rockstar is hinting at something here.",
    "Here's a GTA 6 theory worth thinking about.",
    "One small GTA 6 detail has fans theorizing.",
  ],
  versus: [
    "GTA 6 is breaking one big GTA 5 habit.",
    "Here's how GTA 6 is different from GTA 5.",
  ],
  concept: [
    "Imagine this in GTA 6.",
    "Here's a GTA 6 idea Rockstar should steal.",
    "This GTA 6 concept would go crazy.",
  ],
  "what-if": [
    "What if this GTA 6 detail means more?",
    "One official GTA 6 detail, one wild what-if.",
  ],
  news: [
    "Here's exactly where GTA 6 stands right now.",
    "GTA 6 is almost here. Here's what's official.",
    "The GTA 6 facts that actually matter this week.",
  ],
};

export const CONTEXTS: Record<Idea["format"], string[]> = {
  listicle: [
    "All of them come straight from Rockstar's official character bios.",
    "Every one of these is on Rockstar's official site.",
    "No leaks here. This is all from Rockstar itself.",
    "All straight from Rockstar.",
  ],
  "deep-dive": [
    "Here's what Rockstar's official profile actually says.",
    "This all comes from Rockstar's own character bio.",
  ],
  theory: [
    "First, the confirmed part.",
    "Start with what Rockstar has actually confirmed.",
  ],
  versus: ["Here's what's official so far."],
  concept: [
    "Quick note: this is a fan concept, not something Rockstar announced.",
    "To be clear, this is pure imagination, not leaked info.",
  ],
  "what-if": ["First, the official part.", "Here's what Rockstar actually says."],
  news: ["Here's what Rockstar has officially confirmed.", "Straight from Rockstar's own pages."],
};

export const PAYOFFS: Record<Idea["format"], string[]> = {
  listicle: [
    "Which one did you already know?",
    "Which detail surprised you most?",
    "Be honest, how many did you catch?",
  ],
  "deep-dive": [
    "Do you trust {who} yet?",
    "Is {who} going to be a fan favorite?",
    "What do you think {who}'s real story is?",
  ],
  theory: [
    "Do you buy it, or is it a stretch?",
    "Theory or coincidence? You decide.",
    "Would that change how you play?",
  ],
  versus: ["Which approach do you prefer?"],
  concept: ["Would you play this?", "Should Rockstar make it real?"],
  "what-if": ["Do you buy it?", "Would that be a good twist?"],
  news: ["Are you playing on day one?", "Are you ready for launch?"],
};

export const ORDINALS = ["Number one.", "Number two.", "Number three.", "Number four."];
export const ORDINAL_SCREEN = ["01", "02", "03", "04"];

/** Phrases used by other videos (a project re-running its own script doesn't count against itself). */
export function usedPhrases(kind: string, excludeProject = ""): Set<string> {
  const rows = getDb().prepare(`SELECT text FROM phrases WHERE kind = ? AND project_id != ?`).all(kind, excludeProject) as { text: string }[];
  return new Set(rows.map((r) => r.text));
}

export function markPhraseUsed(kind: string, text: string, projectId: string) {
  getDb().prepare(`INSERT OR IGNORE INTO phrases (kind, text, project_id) VALUES (?, ?, ?)`).run(kind, text, projectId);
}

export function fill(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
