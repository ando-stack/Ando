import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { getConfig } from "../core/config.ts";
import type { Script, Subtitles, Voiceover, WordTiming } from "../core/types.ts";
import { alignSentence } from "../align/align.ts";
import { transcribeWords, type WhisperWord } from "../align/whisper.ts";
import { speechBounds, writeWav } from "../audio/wav.ts";
import { buildPages } from "./captions.ts";
import { splitSentences } from "./pronunciation.ts";
import { groupSpoken, type SpokenGroup, type TtsProvider } from "./providers.ts";

const LEAD_IN = 0.12; // seconds of silence before the hook (instant start, no click)
const TAIL = 0.6;

interface SentenceRec {
  segId: string;
  displayWords: string[];
  groups: SpokenGroup[];
  start: number;
  end: number;
  groupTimes?: number[];
}

/** Characters that will be sent to the TTS provider (for cost estimates). */
export function spokenChars(script: Script): number {
  return script.segments.reduce((n, s) => n + groupSpoken(s.text.split(/\s+/)).map((g) => g.spoken).join(" ").length, 0);
}

const cleanWord = (w: string) => w.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%?!|'’]+$/g, "").replace(/[’]/g, "'");

/**
 * Synthesize narration sentence by sentence, trim TTS silence, insert controlled
 * pauses, loudness-normalize, then derive word timings (TTS timepoints when the
 * provider has them, whisper alignment otherwise, proportional as last resort).
 */
export async function narrate(
  script: Script,
  provider: TtsProvider,
  outWav: string,
  onProgress?: (f: number) => void,
): Promise<{ voiceover: Voiceover; subtitles: Subtitles }> {
  const cfg = getConfig();
  const pieces: Float32Array[] = [];
  const recs: SentenceRec[] = [];
  let sampleRate = 24000;
  let cursor = LEAD_IN;
  const silence = (sec: number) => new Float32Array(Math.round(sec * sampleRate));

  const allSentences = script.segments.flatMap((s) => splitSentences(s.text).map((t) => ({ seg: s, text: t })));
  pieces.push(silence(LEAD_IN));
  for (let i = 0; i < allSentences.length; i++) {
    const { seg, text } = allSentences[i];
    const displayWords = text.split(/\s+/).filter(Boolean);
    const groups = groupSpoken(displayWords);
    const res = await provider.synth(groups);
    if (res.sampleRate !== sampleRate) {
      sampleRate = res.sampleRate;
    }
    const [a, b] = speechBounds(res.samples, res.sampleRate);
    if (b - a < res.sampleRate * 0.2) throw new Error(`TTS returned (near) silence for: "${text}"`);
    const trimmed = res.samples.slice(a, b);
    const start = cursor;
    const end = start + trimmed.length / sampleRate;
    recs.push({
      segId: seg.id,
      displayWords,
      groups,
      start,
      end,
      groupTimes: res.groupTimes?.map((t) => start + t - a / res.sampleRate),
    });
    pieces.push(trimmed);
    const next = allSentences[i + 1];
    const pause = !next ? TAIL : next.seg.id !== seg.id ? cfg.voice.segmentPauseMs / 1000 : cfg.voice.sentencePauseMs / 1000;
    pieces.push(silence(pause));
    cursor = end + pause;
    onProgress?.((i + 1) / allSentences.length);
  }

  const total = pieces.reduce((n, p) => n + p.length, 0);
  const mono = new Float32Array(total);
  let o = 0;
  for (const p of pieces) {
    mono.set(p, o);
    o += p.length;
  }
  const raw = outWav.replace(/\.wav$/, ".raw.wav");
  writeWav(raw, [mono], sampleRate);
  // Two-pass-quality loudness normalization of the narration stem (timing is unchanged).
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", raw,
    "-af", `loudnorm=I=${cfg.voice.targetLufs}:TP=-2:LRA=7,aresample=48000`,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", outWav,
  ]);
  fs.rmSync(raw, { force: true });
  const durationSec = total / sampleRate;

  // ---- word timings
  let alignment: Voiceover["alignment"] = "proportional";
  let heard: WhisperWord[] = [];
  const haveMarks = recs.every((r) => r.groupTimes && r.groupTimes.every((t) => Number.isFinite(t)));
  if (haveMarks) alignment = "tts-marks";
  else {
    try {
      heard = await transcribeWords(outWav, "GTA 6, Rockstar, Leonida, Vice City, Lucia, Jason.");
      alignment = "whisper";
    } catch (e) {
      console.warn("whisper alignment unavailable, falling back to proportional timing:", (e as Error).message);
    }
  }

  const emphasis = new Map<string, Set<string>>();
  for (const s of script.segments) emphasis.set(s.id, new Set(s.emphasis.map((w) => cleanWord(w).toLowerCase())));

  const wordsOut: WordTiming[] = [];
  for (const rec of recs) {
    let spans: { start: number; end: number }[];
    if (alignment === "tts-marks") {
      spans = rec.groupTimes!.map((t, k) => ({ start: t, end: k + 1 < rec.groupTimes!.length ? rec.groupTimes![k + 1] : rec.end }));
    } else {
      spans = alignSentence(rec.groups.map((g) => g.spoken), rec.start, rec.end, heard);
    }
    rec.groups.forEach((g, k) => {
      const { start, end } = spans[k];
      const step = (end - start) / g.words.length;
      g.words.forEach((wi, j) => {
        const text = cleanWord(rec.displayWords[wi]);
        if (!text) return;
        const key = text.toLowerCase().replace(/'s$/, "");
        const emph = emphasis.get(rec.segId)!;
        wordsOut.push({
          text,
          start: +(start + j * step).toFixed(3),
          end: +(start + (j + 1) * step).toFixed(3),
          segId: rec.segId,
          highlight: emph.has(text.toLowerCase()) || emph.has(key),
          brk: /[.!?,;:]$/.test(rec.displayWords[wi]),
        });
      });
    });
  }

  const segments = script.segments.map((s) => {
    const rs = recs.filter((r) => r.segId === s.id);
    return { segId: s.id, start: rs[0].start, end: rs[rs.length - 1].end };
  });

  return {
    voiceover: { file: "voiceover.wav", provider: provider.id, voice: provider.voice, durationSec, segments, alignment },
    subtitles: { words: wordsOut, pages: buildPages(wordsOut) },
  };
}
