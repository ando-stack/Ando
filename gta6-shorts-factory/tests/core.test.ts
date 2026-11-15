import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated DB per test run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-test-"));
process.env.FACTORY_DB = path.join(tmp, "test.db");
process.env.FACTORY_QUIET = "1";

const { toSpoken, splitSentences } = await import("../src/tts/pronunciation.ts");
const { groupSpoken } = await import("../src/tts/providers.ts");
const { alignSentence, normSpoken } = await import("../src/align/align.ts");
const { buildPages } = await import("../src/tts/captions.ts");
const { loadFacts, validateFacts, isStale } = await import("../src/content/factbank.ts");
const { quoteFound, normalizeText } = await import("../src/content/research.ts");
const { scoreScript, readingEase } = await import("../src/content/scoring.ts");
const { offlineIdeas } = await import("../src/content/ideas.ts");
const { writeScriptOffline } = await import("../src/content/writer.ts");
const { synthMusic, synthSfx, buildSfxBed, SR } = await import("../src/audio/synth.ts");
const { textWidthEm, spellCheck } = await import("../src/render/qc.ts");
const { redact, deepMerge } = await import("../src/core/config.ts");
const { getConfig } = await import("../src/core/config.ts");
import type { Fact, ScriptSegment, WordTiming } from "../src/core/types.ts";

test("pronunciation dictionary only changes spoken text", () => {
  assert.equal(toSpoken("GTA 6 is coming."), "GTA six is coming.");
  assert.equal(toSpoken("Lucia's dad"), "Lucia's dad");
  assert.equal(toSpoken("DWNPLY and dwnply"), "down play and dwnply"); // case-sensitive entry
  assert.equal(toSpoken("Raul Bautista"), "rah-ool bow-tee-stuh");
});

test("groupSpoken keeps a 1:1 mapping from display words to spoken groups", () => {
  const words = "Number one. GTA 6 lands November 19th, 2026.".split(" ");
  const groups = groupSpoken(words);
  const covered = groups.flatMap((g) => g.words);
  assert.deepEqual(covered, words.map((_, i) => i));
  const gta = groups.find((g) => g.words.length === 2)!;
  assert.equal(gta.spoken, "GTA six");
  assert.ok(groups.some((g) => g.spoken === "nineteenth,"));
});

test("sentence splitting keeps punctuation", () => {
  assert.deepEqual(splitSentences("The catch? He has to help. Done!"), ["The catch?", "He has to help.", "Done!"]);
});

test("alignment is monotonic and stays inside the sentence", () => {
  const groups = ["Jason", "lives", "rent-free", "at", "one", "of", "Brian's", "properties."];
  const heard = [
    { text: "Jason", start: 1.0, end: 1.3 },
    { text: "lives", start: 1.32, end: 1.6 },
    { text: "rent-free", start: 1.65, end: 2.2 },
    { text: "at one of", start: 2.2, end: 2.6 },
    { text: "Brian's", start: 2.6, end: 3.0 },
    { text: "properties.", start: 3.0, end: 3.7 },
  ];
  const spans = alignSentence(groups, 1.0, 3.7, heard);
  assert.equal(spans.length, groups.length);
  for (let i = 0; i < spans.length; i++) {
    assert.ok(spans[i].start >= 1.0 - 1e-9 && spans[i].end <= 3.7 + 1e-9);
    assert.ok(spans[i].end >= spans[i].start);
    if (i) assert.ok(spans[i].start >= spans[i - 1].start);
  }
  // "rent-free" should land near where it was heard
  assert.ok(Math.abs(spans[2].start - 1.65) < 0.2, `rent-free at ${spans[2].start}`);
  // Without whisper words it falls back to proportional timing
  const prop = alignSentence(groups, 0, 2, []);
  assert.equal(prop[0].start, 0);
  assert.equal(prop[prop.length - 1].end, 2);
  assert.equal(normSpoken("GTA 6"), "gtasix");
});

test("caption pages respect word/char limits and never overlap", () => {
  const cfg = getConfig().captions;
  const words: WordTiming[] = "three gta six details hiding in plain sight all of them come straight from rockstar".split(" ").map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25, segId: i < 8 ? "s1" : "s2", highlight: false, brk: t === "sight" }));
  const pages = buildPages(words);
  for (let i = 0; i < pages.length; i++) {
    assert.ok(pages[i].words.length <= cfg.maxWordsPerPage);
    assert.ok(new Set(pages[i].words.map((w) => w.segId)).size === 1, "page crosses a segment");
    if (i) assert.ok(pages[i].start >= pages[i - 1].end - 1e-9, "pages overlap");
  }
  assert.ok(pages.some((p) => p.words[p.words.length - 1].text === "sight"), "breaks after punctuation");
});

test("fact bank: every CONFIRMED_FACT has a dated source, theories are hedged", () => {
  const facts = loadFacts();
  assert.ok(facts.length >= 20);
  for (const f of facts) {
    if (f.label === "CONFIRMED_FACT") assert.ok(f.sources.length && f.sources[0].retrievedAt && f.sources[0].quote, f.id);
    else assert.ok(f.hedge && f.line.toLowerCase().includes(f.hedge.toLowerCase()), f.id);
  }
  const bad: Fact = { ...facts.find((f) => f.label === "THEORY")!, id: "x", line: "Grassrivers is the Everglades." };
  assert.throws(() => validateFacts([bad]), /hedge/);
  const noSrc: Fact = { ...facts[0], id: "y", sources: [] };
  assert.throws(() => validateFacts([noSrc]), /no dated source/);
  assert.equal(isStale({ ...facts[0], recheckAfter: "2000-01-01" }), true);
});

test("quote matching tolerates curly quotes, dashes and elisions", () => {
  const page = normalizeText("Lucia’s father taught her to fight as soon as she could walk. Life has been coming at her — swinging.");
  assert.ok(quoteFound(page, "Lucia's father taught her to fight ... coming at her - swinging"));
  assert.ok(!quoteFound(page, "Lucia's mother taught her to fight"));
});

test("scoring: dropping a theory's hedge or using clickbait is penalized", () => {
  const facts = loadFacts();
  const theory = facts.find((f) => f.id === "theory-grassrivers")!;
  const seg = (role: ScriptSegment["role"], text: string, extra: Partial<ScriptSegment> = {}): ScriptSegment => ({ id: role + text.length, role, text, label: "NONE", factIds: [], emphasis: [], visual: { kind: "title", text }, ...extra });
  const good = [
    seg("hook", "This GTA 6 theory is hiding in plain sight."),
    seg("context", "Start with what Rockstar has actually confirmed."),
    seg("main", theory.line, { label: "THEORY", factIds: [theory.id], visual: theory.visual }),
    seg("payoff", "Do you buy it, or is it a stretch?"),
  ];
  const ok = scoreScript(good, facts);
  const unhedged = scoreScript([...good.slice(0, 2), { ...good[2], text: "Grassrivers is definitely the Everglades." }, good[3]], facts);
  assert.ok(ok.accuracy > unhedged.accuracy);
  assert.ok(unhedged.total <= 50, "accuracy gate caps the total");
  const clickbait = scoreScript([seg("hook", "SHOCKING leaked GTA 6 proof!"), ...good.slice(1)], facts);
  assert.ok(clickbait.hook < ok.hook);
  assert.ok(readingEase("This is easy to read.") > readingEase("Notwithstanding considerable organizational complexities, interdepartmental communication deteriorated."));
});

test("offline writer produces publishable scripts for every generated idea", () => {
  const cfg = getConfig();
  const ideas = offlineIdeas({ count: 30 });
  assert.ok(ideas.length >= 5);
  for (const idea of ideas) {
    const s = writeScriptOffline(idea);
    assert.ok(s.score.total >= cfg.script.qualityThreshold, `${idea.title}: ${s.score.total} ${s.score.issues.join("; ")}`);
    assert.ok(s.wordCount >= cfg.script.minWords && s.wordCount <= cfg.script.maxWords, `${idea.title}: ${s.wordCount} words`);
    assert.equal(s.segments[0].role, "hook");
    assert.ok(/\?$/.test(s.segments[s.segments.length - 1].text));
    for (const seg of s.segments.filter((x) => x.role === "main")) assert.ok(seg.factIds.length);
  }
});

test("synthesized music and sfx are the right length and never clip", () => {
  const [L, R] = synthMusic(5, { seed: 1 });
  assert.ok(L.length >= 5 * SR && R.length === L.length);
  let peak = 0;
  for (const x of L) peak = Math.max(peak, Math.abs(x));
  assert.ok(peak <= 0.9 && peak > 0.3, `peak ${peak}`);
  for (const t of ["whoosh", "impact", "riser", "reveal", "tick"] as const) assert.ok(synthSfx(t)[0].length > 0);
  const bed = buildSfxBed(3, [{ t: 0.5, type: "whoosh" }, { t: 2.9, type: "impact" }]);
  assert.equal(bed[0].length, 3 * SR);
});

test("QC helpers: caption width model and spelling with project vocabulary", async () => {
  assert.ok(textWidthEm("WWW") > textWidthEm("III"));
  const bad = await spellCheck("Jason lives rent-free at Brian Heder's properties in Leonida. Thsi is wrng.");
  assert.deepEqual(bad.sort(), ["Thsi", "wrng"]);
});

test("secrets are redacted and config merges deeply", () => {
  assert.equal(redact("key sk-ant-abcdefghijklmnop123 here"), "key [REDACTED] here");
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } }), { a: { b: 1, c: 3 } });
});

test("speech matching survives misheard names and split words", async () => {
  const { matchSpeech } = await import("../src/render/qc.ts");
  const cap = "The Real Dimez blew up with an early hit alongside local rapper DWNPLY five years later they signed to Only Raw Records".split(" ").map((t, i) => ({ text: t, start: i * 0.3 }));
  // whisper mishears the names, splits a word, and inserts filler for a while
  const heardText = "The real dimes blue up with an early hit along side local wrapper down play five years later they signed to only raw records";
  const heard = heardText.split(" ").map((t, i) => ({ text: t, start: i * 0.3 + 0.05 }));
  const r = matchSpeech(cap, heard);
  assert.ok(r.matched / r.considered >= 0.7, `${r.matched}/${r.considered}`);
  const garbage = matchSpeech(cap, "completely different words about weather and cooking".split(" ").map((t, i) => ({ text: t, start: i })));
  assert.ok(garbage.matched / garbage.considered < 0.3);
});

test("concept mode: invented beats are hedged, labelled, and never presented as fact", async () => {
  const { loadConceptGroups } = await import("../src/content/factbank.ts");
  const groups = loadConceptGroups();
  assert.ok(groups.length >= 5);
  const facts = loadFacts();
  for (const g of groups)
    for (const b of g.beats) {
      const f = facts.find((x) => x.id === b.id)!;
      assert.ok(f, b.id);
      assert.notEqual(f.label, "CONFIRMED_FACT", `${b.id} is invented but labelled as fact`);
      assert.ok(f.line.toLowerCase().includes(f.hedge!.toLowerCase()), `${b.id} lacks its hedge`);
      assert.equal(f.sources.length, 0);
    }
  const ideas = offlineIdeas({ count: 60 }).filter((i) => i.format === "concept" || i.format === "what-if");
  assert.ok(ideas.length >= 5);
  for (const i of ideas) {
    const s = writeScriptOffline(i);
    assert.ok(s.score.total >= getConfig().script.qualityThreshold, `${i.title}: ${s.score.total}`);
    for (const seg of s.segments) for (const id of seg.factIds) assert.equal(seg.label, facts.find((f) => f.id === id)!.label);
    if (i.format === "concept") assert.match(s.segments[1].text, /concept|imagination/i, "concept videos open with a not-official disclaimer");
  }
});
