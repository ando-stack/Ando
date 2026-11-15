import { getConfig } from "../core/config.ts";
import { getDb } from "../core/db.ts";
import type { Fact, Script, ScriptScore, ScriptSegment } from "../core/types.ts";

export const WORDS_PER_SECOND = 2.75;

export function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
}

export function scriptText(segs: ScriptSegment[]): string {
  return segs.map((s) => s.text).join(" ");
}

export function estimateSeconds(segs: ScriptSegment[]): number {
  const cfg = getConfig();
  const w = words(scriptText(segs)).length;
  const sentences = segs.reduce((n, s) => n + (s.text.match(/[.!?]/g)?.length ?? 1), 0);
  return w / WORDS_PER_SECOND + (sentences * cfg.voice.sentencePauseMs + segs.length * cfg.voice.segmentPauseMs) / 1000 + 0.4;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, m?.length ?? 1);
}

/** Flesch reading ease (higher = easier). Shorts narration should sit around 65+. */
export function readingEase(text: string): number {
  const ws = words(text);
  const sentences = Math.max(1, text.split(/[.!?]+/).filter((s) => s.trim()).length);
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return 206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / Math.max(1, ws.length));
}

function trigrams(text: string): Set<string> {
  const ws = words(text.toLowerCase().replace(/[^a-z0-9\s']/g, " "));
  const out = new Set<string>();
  for (let i = 0; i + 2 < ws.length; i++) out.add(ws.slice(i, i + 3).join(" "));
  return out;
}

export function previousScripts(excludeProject?: string): string[] {
  const rows = getDb()
    .prepare(`SELECT text FROM phrases WHERE kind = 'script' AND project_id != ?`)
    .all(excludeProject ?? "") as { text: string }[];
  return rows.map((r) => r.text);
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const CURIOSITY = /\b(you|missed|hidden|hiding|secret|nobody|most|actually|quietly|never|really|half|underrated|theory|hinting|almost)\b/i;
const CLICKBAIT = /\b(leaked|100%|guaranteed|proof|shocking|you won't believe|confirmed leak|exposed)\b/i;
const ABSOLUTE = /\b(confirmed|definitely|officially|proves?|fact)\b/i;

export function scoreScript(segs: ScriptSegment[], facts: Fact[], opts: { projectId?: string } = {}): ScriptScore {
  const cfg = getConfig();
  const issues: string[] = [];
  const all = scriptText(segs);
  const wc = words(all).length;
  const hook = segs.find((s) => s.role === "hook");
  const payoff = segs.find((s) => s.role === "payoff");
  const mains = segs.filter((s) => s.role === "main");

  // Hook strength
  let h = 50;
  if (!hook) issues.push("No hook segment.");
  else {
    const hw = words(hook.text).length;
    if (hw <= 10) h += 20;
    else if (hw <= 13) h += 8;
    else issues.push(`Hook is ${hw} words; keep it under 10 so it lands in ~2 seconds.`);
    if (CURIOSITY.test(hook.text)) h += 15;
    else issues.push("Hook lacks a curiosity trigger (you / missed / hidden / most...).");
    if (/\d|\bthree\b|\bthis\b/i.test(hook.text)) h += 10;
    if (/GTA ?(6|VI)/i.test(hook.text)) h += 5;
    if (CLICKBAIT.test(hook.text)) {
      h -= 40;
      issues.push("Hook uses misleading clickbait wording.");
    }
  }

  // Clarity
  const sentences = all.split(/(?<=[.!?])\s+/).filter(Boolean);
  const longest = Math.max(...sentences.map((s) => words(s).length));
  const ease = readingEase(all);
  let c = 60 + Math.min(25, (ease - 50) * 0.8);
  if (longest > 20) {
    c -= (longest - 20) * 3;
    issues.push(`Longest sentence has ${longest} words; split it.`);
  } else c += 15;

  // Originality
  let o = 100;
  const tri = trigrams(all);
  let maxOverlap = 0;
  for (const prev of previousScripts(opts.projectId)) {
    const p = trigrams(prev);
    const inter = [...tri].filter((t) => p.has(t)).length;
    maxOverlap = Math.max(maxOverlap, inter / Math.max(1, tri.size));
  }
  o -= maxOverlap * 120;
  if (maxOverlap > 0.35) issues.push(`Script overlaps ${(maxOverlap * 100).toFixed(0)}% with a previous video.`);
  const usedHooks = new Set(
    (getDb().prepare(`SELECT text FROM phrases WHERE kind='hook' AND project_id != ?`).all(opts.projectId ?? "") as { text: string }[]).map((r) => r.text),
  );
  if (hook && usedHooks.has(hook.text)) {
    o -= 30;
    issues.push("Hook was already used in a previous video.");
  }

  // Accuracy
  let a = 100;
  const factMap = new Map(facts.map((f) => [f.id, f]));
  for (const s of segs) {
    for (const id of s.factIds) {
      const f = factMap.get(id);
      if (!f) {
        a -= 50;
        issues.push(`Segment ${s.id} references unknown fact ${id}.`);
        continue;
      }
      if (f.label === "CONFIRMED_FACT" && !f.sources.length) {
        a -= 50;
        issues.push(`${id} is presented as fact without a source.`);
      }
      if ((f.label === "THEORY" || f.label === "SPECULATION") && f.hedge && !s.text.toLowerCase().includes(f.hedge.toLowerCase())) {
        a -= 60;
        issues.push(`${id} is a ${f.label} but the narration drops its hedge "${f.hedge}".`);
      }
      if (f.label !== "CONFIRMED_FACT" && ABSOLUTE.test(s.text.replace(/isn't confirmed|not confirmed|never said|nothing official/gi, ""))) {
        a -= 30;
        issues.push(`${id} (${f.label}) uses absolute wording.`);
      }
      if (s.label !== f.label) {
        a -= 25;
        issues.push(`Segment ${s.id} label ${s.label} does not match fact label ${f.label}.`);
      }
    }
    if (s.role === "main" && !s.factIds.length) {
      a -= 40;
      issues.push(`Main segment ${s.id} makes claims without a fact reference.`);
    }
  }

  // Visual potential
  const kinds = new Set(segs.map((s) => s.visual.kind));
  const specific = segs.filter((s) => s.visual.kind !== "title").length / Math.max(1, segs.length);
  const v = 40 + specific * 40 + Math.min(20, kinds.size * 5);

  // Retention
  let rt = 100;
  const secs = estimateSeconds(segs);
  if (wc < cfg.script.minWords) {
    rt -= (cfg.script.minWords - wc) * 2;
    issues.push(`Only ${wc} words; aim for ${cfg.script.minWords}-${cfg.script.maxWords}.`);
  }
  if (wc > cfg.script.maxWords) {
    rt -= (wc - cfg.script.maxWords) * 2.5;
    issues.push(`${wc} words is too long; aim for ${cfg.script.minWords}-${cfg.script.maxWords}.`);
  }
  if (secs > cfg.video.maxSeconds) {
    rt -= (secs - cfg.video.maxSeconds) * 6;
    issues.push(`Estimated ${secs.toFixed(1)}s exceeds ${cfg.video.maxSeconds}s.`);
  }
  if (secs < cfg.video.minSeconds) {
    rt -= (cfg.video.minSeconds - secs) * 6;
    issues.push(`Estimated ${secs.toFixed(1)}s is shorter than ${cfg.video.minSeconds}s.`);
  }
  if (!payoff || !/\?\s*$/.test(payoff.text)) {
    rt -= 15;
    issues.push("Payoff should end on a question to invite comments.");
  }
  if (mains.length < 1) rt -= 30;
  if (hook && words(hook.text).length / WORDS_PER_SECOND > 3) rt -= 10;

  const s = { hook: clamp(h), clarity: clamp(c), originality: clamp(o), accuracy: clamp(a), visual: clamp(v), retention: clamp(rt) };
  // Accuracy is a gate: a script that misrepresents a claim can never pass on other strengths.
  let total = s.hook * 0.2 + s.clarity * 0.15 + s.originality * 0.15 + s.accuracy * 0.25 + s.visual * 0.1 + s.retention * 0.15;
  if (s.accuracy < 90) total = Math.min(total, 50);
  return { ...s, total: clamp(total), issues };
}

export function weakest(score: ScriptScore): keyof Omit<ScriptScore, "total" | "issues"> {
  const dims = ["hook", "clarity", "originality", "accuracy", "visual", "retention"] as const;
  return dims.reduce((a, b) => (score[b] < score[a] ? b : a));
}

export function summarize(script: Script) {
  return `${script.title} — ${script.wordCount} words, ~${script.estSeconds.toFixed(1)}s, score ${script.score.total}`;
}
