import { getConfig } from "../core/config.ts";
import type { Fact, Idea, Script, ScriptSegment } from "../core/types.ts";
import { factById, isStale } from "./factbank.ts";
import { CHARACTERS } from "./ideas.ts";
import { CONTEXTS, HOOKS, ORDINALS, ORDINAL_SCREEN, PAYOFFS, fill, usedPhrases } from "./phrases.ts";
import { estimateSeconds, scoreScript, scriptText, weakest, words } from "./scoring.ts";

interface Variant {
  hook: string;
  context: string;
  payoff: string;
  withRelease: boolean;
  ordinals: boolean;
}

function whoFor(facts: Fact[]): string {
  for (const f of facts) {
    const w = CHARACTERS[f.keywords[0]];
    if (w) return w;
  }
  return "this character";
}

function hookVisual(idea: Idea, facts: Fact[]): ScriptSegment["visual"] {
  if (idea.format === "listicle") return { kind: "title", text: idea.title };
  if (idea.format === "deep-dive") return { kind: "character", name: whoFor(facts), role: "Official profile" };
  if (idea.format === "theory") return { kind: "icon", icon: "eye", text: "THEORY" };
  return { kind: "title", text: idea.title };
}

export function buildSegments(idea: Idea, facts: Fact[], v: Variant): ScriptSegment[] {
  const segs: ScriptSegment[] = [];
  segs.push({ id: "s1", role: "hook", text: v.hook, label: "NONE", factIds: [], emphasis: words(v.hook).filter((w) => /\d|GTA|missed|hidden|hiding|nobody|secret|theory/i.test(w)), visual: hookVisual(idea, facts) });
  segs.push({ id: "s2", role: "context", text: v.context, label: "NONE", factIds: [], emphasis: ["Rockstar's", "official"], visual: { kind: "title", text: "STRAIGHT FROM ROCKSTAR" } });
  facts.forEach((f, i) => {
    const prefix = v.ordinals && idea.format === "listicle" ? ORDINALS[i] + " " : "";
    segs.push({
      id: `s${segs.length + 1}`,
      role: "main",
      text: prefix + f.line,
      onScreen: idea.format === "listicle" ? ORDINAL_SCREEN[i] : undefined,
      label: f.label,
      factIds: [f.id],
      emphasis: f.emphasis,
      visual: f.visual,
    });
  });
  const release = factById("release-date");
  const useRelease = v.withRelease && release && !isStale(release) && !facts.some((f) => f.id === "release-date");
  segs.push({
    id: `s${segs.length + 1}`,
    role: "payoff",
    text: (useRelease ? release!.line + " " : "") + v.payoff,
    label: useRelease ? "CONFIRMED_FACT" : "NONE",
    factIds: useRelease ? [release!.id] : [],
    emphasis: useRelease ? release!.emphasis : [],
    visual: useRelease ? release!.visual : { kind: "icon", icon: "question", text: "YOUR CALL" },
  });
  return segs;
}

function variants(idea: Idea, facts: Fact[]): Variant[] {
  const vars = { n: facts.length, who: whoFor(facts) };
  const usedHooks = usedPhrases("hook");
  const usedPayoffs = usedPhrases("payoff");
  const hooks = [idea.hook, ...HOOKS[idea.format].map((h) => fill(h, vars))].filter((h, i, a) => a.indexOf(h) === i);
  // Fresh phrases first so the search prefers them, but keep used ones as a fallback.
  const order = (arr: string[], used: Set<string>) => [...arr.filter((x) => !used.has(x)), ...arr.filter((x) => used.has(x))];
  const out: Variant[] = [];
  for (const hook of order(hooks, usedHooks))
    for (const context of CONTEXTS[idea.format])
      for (const payoff of order(PAYOFFS[idea.format].map((p) => fill(p, vars)), usedPayoffs))
        for (const withRelease of [true, false])
          for (const ordinals of idea.format === "listicle" ? [true, false] : [false])
            out.push({ hook, context, payoff, withRelease, ordinals });
  return out;
}

/**
 * Offline writer: assembles a script from verified fact-bank lines, then runs an
 * improvement loop — each round scores the current draft, finds the weakest
 * dimension and searches variants that raise it, until the quality threshold is met.
 */
export function writeScriptOffline(idea: Idea, projectId?: string): Script {
  const cfg = getConfig();
  const facts = idea.factIds.map((id) => {
    const f = factById(id);
    if (!f) throw new Error(`Idea references unknown fact "${id}"`);
    return f;
  });
  const all = variants(idea, facts);
  const factsForScoring = [...facts, ...(factById("release-date") ? [factById("release-date")!] : [])];
  const evaluate = (v: Variant) => {
    const segs = buildSegments(idea, facts, v);
    return { v, segs, score: scoreScript(segs, factsForScoring, { projectId }) };
  };

  let current = evaluate(all[0]);
  const revisions: Script["revisions"] = [{ round: 0, total: current.score.total, note: "initial draft" }];
  const scored = all.map(evaluate);
  for (let round = 1; round <= cfg.script.maxImproveRounds && current.score.total < 100; round++) {
    const dim = weakest(current.score);
    const better = scored
      .filter((c) => c.score.total > current.score.total)
      .sort((a, b) => b.score[dim] - a.score[dim] || b.score.total - a.score.total)[0];
    if (!better) break;
    revisions.push({ round, total: better.score.total, note: `improved weakest dimension "${dim}" (${current.score[dim]} → ${better.score[dim]})` });
    current = better;
    if (current.score.total >= cfg.script.qualityThreshold && round >= 1 && weakest(current.score) === dim) break;
  }

  return {
    title: idea.title,
    segments: current.segs,
    wordCount: words(scriptText(current.segs)).length,
    estSeconds: estimateSeconds(current.segs),
    score: current.score,
    revisions,
    writer: "offline",
  };
}
