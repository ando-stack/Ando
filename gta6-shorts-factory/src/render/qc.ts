import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getConfig } from "../core/config.ts";
import type { QcCheck, ResearchResult, ScenePlan, Script, Subtitles } from "../core/types.ts";
import { loadFacts } from "../content/factbank.ts";
import { runCapture } from "../audio/mix.ts";
import { transcribeWords } from "../align/whisper.ts";
import { normSpoken } from "../align/align.ts";
import { loadPronunciations } from "../tts/pronunciation.ts";

const require = createRequire(import.meta.url);

interface Probe {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string; nb_read_packets?: string; channels?: number }[];
  format: { duration: string };
}

export function probe(file: string): Probe {
  return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_streams", "-show_format", "-of", "json", file]).toString()) as Probe;
}

// Approximate advance widths (em) for Inter Black uppercase — used to predict caption overflow without a browser.
const WIDE = new Set("MW".split(""));
const NARROW = new Set("IJ1!'.,:;|".split(""));
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += ch === " " ? 0.27 : WIDE.has(ch) ? 0.95 : NARROW.has(ch) ? 0.34 : 0.72;
  return w;
}

let speller: { correct: (w: string) => boolean } | null = null;
async function getSpeller() {
  if (speller) return speller;
  const nspell = require("nspell");
  const dictDir = path.dirname(require.resolve("dictionary-en"));
  const dict = { aff: fs.readFileSync(path.join(dictDir, "index.aff")), dic: fs.readFileSync(path.join(dictDir, "index.dic")) };
  const sp = nspell(dict);
  // Project vocabulary: names and terms from the fact bank + pronunciation dictionary.
  const vocab = new Set<string>(["GTA", "VI", "Rockstar", "Rockstar's", "Leonida", "PS5", "Xbox", "DWNPLY", "Dimez", "bios", "pre-load", "Pre-loading", "rent-free"]);
  for (const f of loadFacts()) for (const t of [...f.keywords, f.line, f.claim].join(" ").split(/[^A-Za-z'-]+/)) if (/^[A-Z]/.test(t)) vocab.add(t);
  for (const e of loadPronunciations()) for (const t of e.term.split(/\s+/)) vocab.add(t);
  for (const v of vocab) sp.add(v);
  speller = sp;
  return sp;
}

export async function spellCheck(text: string): Promise<string[]> {
  const sp = await getSpeller();
  const bad = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, "").replace(/'s$/, "");
    if (!w || /\d/.test(raw)) continue;
    const parts = w.split("-");
    if (!sp.correct(w) && !parts.every((p) => sp.correct(p) || sp.correct(p.toLowerCase()))) bad.add(w);
  }
  return [...bad];
}

/**
 * Validate the finished MP4 and every intermediate artifact before export.
 * Any "error" blocks export; "warning" is shown in the dashboard but allows export.
 */
export async function runQc(opts: {
  projectDir: string;
  video: string;
  script: Script;
  plan: ScenePlan;
  subtitles: Subtitles;
  research: ResearchResult;
}): Promise<QcCheck[]> {
  const cfg = getConfig();
  const checks: QcCheck[] = [];
  const add = (name: string, ok: boolean, detail: string, severity: QcCheck["severity"] = "error") => checks.push({ name, ok, detail, severity });

  // ---- container / streams
  const p = probe(opts.video);
  const v = p.streams.find((s) => s.codec_type === "video");
  const a = p.streams.find((s) => s.codec_type === "audio");
  const dur = Number(p.format.duration);
  add("Resolution", v?.width === cfg.video.width && v?.height === cfg.video.height, `${v?.width}×${v?.height} (expected ${cfg.video.width}×${cfg.video.height})`);
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  add("Frame rate", Math.abs(num / den - cfg.video.fps) < 0.01, `${(num / den).toFixed(2)} fps`);
  add("Video codec", v?.codec_name === "h264" && v?.pix_fmt === "yuv420p", `${v?.codec_name} ${v?.pix_fmt}`);
  add("Audio codec", a?.codec_name === "aac" && a?.sample_rate === "48000", `${a?.codec_name ?? "none"} ${a?.sample_rate ?? ""} Hz`);
  add("Duration", dur >= cfg.video.minSeconds - 0.5 && dur <= cfg.video.maxSeconds + 0.5, `${dur.toFixed(2)} s (target ${cfg.video.minSeconds}–${cfg.video.maxSeconds} s)`);
  const expectedFrames = Math.ceil(opts.plan.durationSec * cfg.video.fps);
  const frames = Number(v?.nb_read_packets ?? 0);
  add("Frame count", Math.abs(frames - expectedFrames) <= 2, `${frames} frames (expected ${expectedFrames})`);

  // ---- picture: black / missing frames
  const black = runCapture(["-hide_banner", "-i", opts.video, "-vf", "blackdetect=d=0.1:pix_th=0.06", "-an", "-f", "null", "-"]);
  const blackHits = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(2)}–${(+m[2]).toFixed(2)}s`);
  add("No black frames", blackHits.length === 0, blackHits.length ? `black at ${blackHits.join(", ")}` : "none detected");
  const freeze = runCapture(["-hide_banner", "-i", opts.video, "-vf", "freezedetect=n=0.0005:d=2.5", "-an", "-f", "null", "-"]);
  const frozen = [...freeze.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(2)}s`);
  add("No frozen picture", frozen.length === 0, frozen.length ? `static picture from ${frozen.join(", ")}` : "picture moves throughout", "warning");

  // ---- audio
  const ebur = runCapture(["-hide_banner", "-i", opts.video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const I = Number(ebur.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const tp = Number(ebur.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  add("Loudness", Math.abs(I - cfg.audio.targetLufs) <= 1.5, `${I.toFixed(1)} LUFS (target ${cfg.audio.targetLufs})`);
  add("No clipping", tp <= cfg.audio.truePeak + 0.6, `true peak ${tp.toFixed(1)} dBFS (limit ${cfg.audio.truePeak}; AAC encoding can add a few tenths)`);
  const vo = path.join(opts.projectDir, "voiceover.wav");
  const sil = runCapture(["-hide_banner", "-i", vo, "-af", "silencedetect=n=-40dB:d=0.5", "-f", "null", "-"]);
  const silent = [...sil.matchAll(/silence_duration: ([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  const voDur = Number(probe(vo).format.duration);
  add("Voiceover present", silent / voDur < 0.3, `${((1 - silent / voDur) * 100).toFixed(0)}% of narration has speech`);

  // ---- assets
  const missing = opts.plan.scenes.filter((s) => s.asset.path && !fs.existsSync(path.join(opts.projectDir, s.asset.path))).map((s) => s.asset.path);
  add("Assets present", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${opts.plan.scenes.filter((s) => s.asset.path).length} library assets, rest original graphics`);
  add("Real visuals", !opts.plan.placeholderVisuals, opts.plan.placeholderVisuals ? "All scenes use original placeholder motion graphics (labelled on screen). Add approved assets to assets/library for real visuals." : "library assets used", "warning");

  // ---- subtitles: overflow + timing
  const c = cfg.captions;
  const maxW = 1080 - 2 * 90 - 40;
  const overflow = opts.subtitles.pages.filter((pg) => {
    const longest = Math.max(...pg.words.map((w) => textWidthEm(w.text))) * c.fontSize;
    const total = textWidthEm(pg.words.map((w) => w.text).join(" ")) * c.fontSize;
    return longest > maxW || total > maxW * 2;
  });
  add("Subtitle overflow", overflow.length === 0, overflow.length ? `pages too wide: ${overflow.map((o) => o.words.map((w) => w.text).join(" ")).join(" | ")}` : `${opts.subtitles.pages.length} caption pages fit (max 2 lines)`);
  const words = opts.subtitles.words;
  const badOrder = words.some((w, i) => w.end < w.start || (i > 0 && w.start + 0.001 < words[i - 1].start));
  const tooShort = words.filter((w) => w.end - w.start < 0.05).length;
  const outside = words.filter((w) => w.end > dur + 0.05).length;
  add("Subtitle timing", !badOrder && outside === 0 && tooShort <= 2, `monotonic=${!badOrder}, outside video=${outside}, <50ms words=${tooShort}`);

  // Independent sync check: transcribe the final mix and compare word starts with captions.
  try {
    const wav = path.join(opts.projectDir, "qc-audio.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", opts.video, "-vn", "-ac", "1", "-ar", "16000", wav]);
    const heard = await transcribeWords(wav);
    fs.rmSync(wav, { force: true });
    let matched = 0;
    const offsets: number[] = [];
    let j = 0;
    for (const w of words) {
      const target = normSpoken(w.text);
      if (target.length < 3) continue;
      for (let k = j; k < Math.min(heard.length, j + 6); k++) {
        if (normSpoken(heard[k].text) === target) {
          offsets.push(Math.abs(heard[k].start - w.start));
          matched++;
          j = k + 1;
          break;
        }
      }
    }
    const considered = words.filter((w) => normSpoken(w.text).length >= 3).length;
    const median = offsets.sort((x, y) => x - y)[Math.floor(offsets.length / 2)] ?? 99;
    add("Speech matches script", matched / Math.max(1, considered) >= 0.7, `${matched}/${considered} caption words heard in the final audio`);
    add("Caption sync", median <= 0.25, `median caption offset ${(median * 1000).toFixed(0)} ms vs. speech`);
  } catch (e) {
    add("Caption sync", false, `could not verify (whisper unavailable): ${(e as Error).message}`, "warning");
  }

  // ---- language + claims
  const allText = opts.script.segments.map((s) => s.text).join(" ");
  const misspelled = await spellCheck(allText);
  add("English spelling", misspelled.length === 0, misspelled.length ? `unknown words: ${misspelled.join(", ")}` : "no unknown words", "warning");

  const verdicts = new Map(opts.research.facts.map((f) => [f.id, f]));
  const claimProblems: string[] = [];
  const claimWarnings: string[] = [];
  for (const s of opts.script.segments) {
    if (s.role === "main" && !s.factIds.length) claimProblems.push(`${s.id} has no fact reference`);
    for (const id of s.factIds) {
      const r = verdicts.get(id);
      if (!r) claimProblems.push(`${id} was never fact-checked`);
      else if (r.label === "CONFIRMED_FACT" && (r.verdict === "unsupported" || r.verdict === "stale")) claimProblems.push(`${id}: ${r.verdict}`);
      else if (r.label === "CONFIRMED_FACT" && r.verdict === "source-unreachable") claimWarnings.push(`${id}: source not re-checked today`);
      if (r && r.label !== s.label) claimProblems.push(`${s.id} shows ${s.label} but ${id} is ${r.label}`);
    }
  }
  add("No unverified claims as fact", claimProblems.length === 0, claimProblems.length ? claimProblems.join("; ") : "every claim is verified or labelled THEORY/SPECULATION");
  if (claimWarnings.length) add("Sources re-checked", false, claimWarnings.join("; "), "warning");

  // ---- duplicate scenes
  const sig = opts.plan.scenes.map((s) => JSON.stringify(s.visual) + (s.asset.path ?? ""));
  const dupes = sig.map((x, i) => (i > 0 && x === sig[i - 1] ? opts.plan.scenes[i].id : null)).filter(Boolean);
  add("No duplicate scenes", dupes.length === 0, dupes.length ? `repeated back-to-back: ${dupes.join(", ")}` : `${opts.plan.scenes.length} distinct scenes`);
  const assetUse = opts.plan.scenes.map((s) => s.asset.path).filter(Boolean);
  add("Asset variety", new Set(assetUse).size === assetUse.length, `${assetUse.length - new Set(assetUse).size} reused library assets`, "warning");

  return checks;
}

export function qcPassed(checks: QcCheck[]) {
  return checks.every((c) => c.ok || c.severity === "warning");
}

/** 3×3 contact sheet of the finished video for the library page. */
export function contactSheet(video: string, out: string, durationSec: number) {
  const step = Math.max(0.5, durationSec / 9);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", `fps=1/${step.toFixed(3)},scale=240:426,tile=9x1:padding=4`, "-frames:v", "1", out]);
}
