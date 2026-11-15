import fs from "node:fs";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getConfig, getSecret, r } from "../core/config.ts";
import { now } from "../core/db.ts";
import type { Category, Fact, Idea, Script, ScriptSegment } from "../core/types.ts";
import { loadFacts, validateFacts } from "./factbank.ts";
import { estimateSeconds, scoreScript, scriptText, words } from "./scoring.ts";

// Optional "Claude mode": live web research + script writing. Everything still
// goes through the same fact check (quotes must be found on the cited page),
// scoring and QC as the offline writer. Off unless ANTHROPIC_API_KEY is set.

// $/MTok from the Anthropic model table (Claude Opus 5.5: $4 in / $20 out).
// Web search is billed per search — check https://platform.claude.com/docs/en/about-claude/pricing
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};
const WEB_SEARCH_USD = 0.01; // per search (verify on the pricing page before relying on it)

export function claudeAvailable() {
  return Boolean(getSecret("ANTHROPIC_API_KEY"));
}

function client() {
  const key = getSecret("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured (Settings → API credentials).");
  return new Anthropic({ apiKey: key });
}

export function estimateClaudeCost(kind: "ideas" | "script"): { usd: number; detail: string } {
  const cfg = getConfig().llm;
  const p = PRICES[cfg.model] ?? PRICES["claude-opus-5-5"];
  if (kind === "ideas") {
    const inTok = 45_000, outTok = 8_000, searches = cfg.maxSearches;
    const usd = (inTok * p.in + outTok * p.out) / 1e6 + searches * WEB_SEARCH_USD;
    return { usd, detail: `${cfg.model}: ~${inTok / 1000}k input + ~${outTok / 1000}k output tokens (incl. thinking) + up to ${searches} web searches. Upper estimate.` };
  }
  const rounds = 3;
  const inTok = 6_000 * rounds, outTok = 4_000 * rounds;
  return { usd: (inTok * p.in + outTok * p.out) / 1e6, detail: `${cfg.model}: up to ${rounds} write/revise rounds (~${inTok / 1000}k in / ~${outTok / 1000}k out tokens). Upper estimate.` };
}

const DISCOVERED = r("data", "facts-discovered.json");

export function loadDiscovered(): Fact[] {
  try {
    return (JSON.parse(fs.readFileSync(DISCOVERED, "utf8")) as { facts: Fact[] }).facts;
  } catch {
    return [];
  }
}

function saveDiscovered(facts: Fact[]) {
  const all = [...loadDiscovered().filter((f) => !facts.some((n) => n.id === f.id)), ...facts];
  validateFacts([...loadFacts().filter((f) => !all.some((a) => a.id === f.id)), ...all]);
  fs.writeFileSync(DISCOVERED, JSON.stringify({ version: 1, facts: all }, null, 2));
}

const SYSTEM = `You research and write YouTube Shorts about Grand Theft Auto VI for a faceless channel.
Rules that override everything else:
- Never invent facts. A CONFIRMED_FACT needs a source page you actually read, plus a short quote copied verbatim from that page.
- Prefer primary sources (rockstargames.com, Rockstar Newswire, Take-Two investor releases). Reputable outlets (Bloomberg, IGN, The Verge, Eurogamer) are acceptable as secondary sources.
- Leaks, datamines, rumors and fan analysis are THEORY or SPECULATION, never facts, and their narration line must contain a hedge such as "fans think", "rumored", "speculation" or "isn't confirmed".
- Do not assume the release date or game status: check it.
- Fan-made or AI-generated images are never presented as real gameplay.
- Output English only.`;

const VisualZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), name: z.string(), role: z.string() }),
  z.object({ kind: z.literal("map"), region: z.string() }),
  z.object({ kind: z.literal("quote"), text: z.string(), attribution: z.string() }),
  z.object({ kind: z.literal("icon"), icon: z.enum(["radio", "boat", "lock", "calendar", "console", "money", "music", "eye", "question", "pin"]), text: z.string() }),
  z.object({ kind: z.literal("stat"), value: z.string(), caption: z.string() }),
  z.object({ kind: z.literal("title"), text: z.string() }),
]);

const FactZ = z.object({
  id: z.string().describe("kebab-case unique id"),
  label: z.enum(["CONFIRMED_FACT", "THEORY", "SPECULATION", "AI_CONCEPT"]),
  claim: z.string(),
  line: z.string().describe("one spoken sentence, 8-22 words; must include the hedge word for THEORY/SPECULATION"),
  hedge: z.string().describe("hedge phrase contained in line; empty string for CONFIRMED_FACT"),
  emphasis: z.array(z.string()).describe("2-3 words from line to highlight"),
  keywords: z.array(z.string()),
  visual: VisualZ,
  sourceUrl: z.string().describe("page the quote comes from; empty for THEORY/SPECULATION without a source"),
  sourceTitle: z.string(),
  publisher: z.string(),
  publishedAt: z.string().describe("ISO date if shown on the page, else empty"),
  quote: z.string().describe("verbatim text copied from the page supporting the claim"),
});

const IdeasZ = z.object({
  releaseStatus: z.string(),
  ideas: z.array(
    z.object({
      title: z.string(),
      category: z.enum(["secrets", "facts", "theories", "comparisons", "mysteries", "ai-concepts", "news", "characters"]),
      format: z.enum(["listicle", "deep-dive", "theory", "versus", "news"]),
      hook: z.string().describe("max 10 words, honest, no clickbait"),
      angle: z.string(),
      facts: z.array(FactZ).min(1).max(4),
    }),
  ),
});

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
}

/** Research fresh ideas on the web, then extract structured, source-quoted facts. */
export async function claudeIdeas(opts: { category: Category | "any"; count: number; avoidTopics: string[] }): Promise<{ ideas: Idea[]; facts: Fact[]; notes: string }> {
  const cfg = getConfig().llm;
  const c = client();
  const research = await c.beta.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: cfg.effort as "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: cfg.maxSearches }],
    messages: [
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}. Research GTA VI and propose ${opts.count} original YouTube Shorts ideas${opts.category !== "any" ? ` in the category "${opts.category}"` : ""}.
First confirm the current official release date/status. Prefer lesser-known, specific, verifiable details over generic news. Avoid these topics already covered: ${opts.avoidTopics.join(", ") || "none"}.
For every factual claim, record the exact page URL and copy a short verbatim quote from it.`,
      },
    ],
  });
  if (research.stop_reason === "refusal") throw new Error("Claude declined the research request.");
  const notes = textOf(research.content);

  const extracted = await c.beta.messages.parse({
    model: cfg.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "low", format: betaZodOutputFormat(IdeasZ) },
    messages: [{ role: "user", content: `Convert these research notes into the schema. Drop any claim without a verbatim quote and URL unless it is labelled THEORY/SPECULATION.\n\n${notes}` }],
  });
  const parsed = extracted.parsed_output;
  if (!parsed) throw new Error("Claude returned no parsable ideas.");

  const today = now().slice(0, 10);
  const facts: Fact[] = [];
  const ideas: Idea[] = parsed.ideas.map((i) => {
    const ids: string[] = [];
    for (const f of i.facts) {
      const id = "web-" + f.id.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 40) + "-" + crypto.randomBytes(2).toString("hex");
      ids.push(id);
      facts.push({
        id,
        category: i.category,
        label: f.label,
        claim: f.claim,
        line: f.line,
        emphasis: f.emphasis,
        visual: f.visual as Fact["visual"],
        keywords: f.keywords.length ? f.keywords.map((k) => k.toLowerCase()) : [i.category],
        topic: id,
        hedge: f.hedge || undefined,
        sources: f.sourceUrl ? [{ url: f.sourceUrl, title: f.sourceTitle, publisher: f.publisher, publishedAt: f.publishedAt || undefined, retrievedAt: today, quote: f.quote, primary: /rockstargames\.com|take2games\.com/.test(f.sourceUrl) }] : [],
      });
    }
    return {
      id: "idea-" + crypto.randomBytes(4).toString("hex"),
      title: i.title,
      category: i.category,
      format: i.format,
      hook: i.hook,
      angle: i.angle,
      factIds: ids,
      labels: [...new Set(i.facts.map((f) => f.label))],
      topicKey: "web:" + i.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      writer: "claude" as const,
      createdAt: now(),
    };
  });
  // Keep only facts that satisfy the bank's rules (sources for facts, hedges for theories).
  const ok = facts.filter((f) => {
    try {
      validateFacts([f]);
      return true;
    } catch {
      return false;
    }
  });
  saveDiscovered(ok);
  return { ideas: ideas.filter((i) => i.factIds.every((id) => ok.some((f) => f.id === id))), facts: ok, notes: parsed.releaseStatus };
}

const SegmentsZ = z.object({
  segments: z.array(
    z.object({
      role: z.enum(["hook", "context", "main", "payoff"]),
      text: z.string(),
      factIds: z.array(z.string()),
      emphasis: z.array(z.string()),
      onScreen: z.string().describe("short on-screen tag like 01/02, or empty"),
    }),
  ),
});

/** Write (and revise) a script with Claude; scoring and fact rules are enforced locally. */
export async function claudeScript(idea: Idea, facts: Fact[], projectId?: string): Promise<Script> {
  const cfg = getConfig();
  const c = client();
  const factList = facts.map((f) => `- id=${f.id} [${f.label}] ${f.claim}${f.hedge ? ` (hedge: "${f.hedge}")` : ""}\n  suggested line: ${f.line}`).join("\n");
  let feedback = "";
  let best: Script | null = null;
  const revisions: Script["revisions"] = [];
  for (let round = 0; round < 3; round++) {
    const res = await c.beta.messages.parse({
      model: cfg.llm.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: cfg.llm.effort as "medium", format: betaZodOutputFormat(SegmentsZ) },
      messages: [
        {
          role: "user",
          content: `Write a ${cfg.video.minSeconds}-${cfg.video.maxSeconds} second YouTube Short narration (${cfg.script.minWords}-${cfg.script.maxWords} words) titled "${idea.title}".
Structure: hook (0-2s, max 10 words), context (one short sentence), main (one segment per fact, cite its id in factIds), payoff (ends with a question; no fake cliffhanger).
Only use these facts; keep THEORY/SPECULATION hedges verbatim:
${factList}
Hook idea: ${idea.hook}
${feedback ? `Fix these problems from the previous draft:\n${feedback}` : ""}`,
        },
      ],
    });
    const out = res.parsed_output;
    if (!out) continue;
    const segs: ScriptSegment[] = out.segments.map((s, i) => {
      const f = facts.find((x) => s.factIds.includes(x.id));
      return {
        id: `s${i + 1}`,
        role: s.role,
        text: s.text.trim(),
        onScreen: s.onScreen || undefined,
        label: f ? f.label : "NONE",
        factIds: s.factIds.filter((id) => facts.some((x) => x.id === id)),
        emphasis: s.emphasis,
        visual: f ? f.visual : s.role === "hook" ? { kind: "title", text: idea.title } : { kind: "icon", icon: "question", text: "YOUR CALL" },
      };
    });
    const score = scoreScript(segs, facts, { projectId });
    const draft: Script = { title: idea.title, segments: segs, wordCount: words(scriptText(segs)).length, estSeconds: estimateSeconds(segs), score, revisions, writer: "claude" };
    revisions.push({ round, total: score.total, note: round === 0 ? "Claude draft" : "Claude revision from QC feedback" });
    if (!best || score.total > best.score.total) best = draft;
    if (score.total >= cfg.script.qualityThreshold) break;
    feedback = score.issues.map((x) => `- ${x}`).join("\n");
  }
  if (!best) throw new Error("Claude did not return a usable script.");
  return { ...best, revisions };
}
