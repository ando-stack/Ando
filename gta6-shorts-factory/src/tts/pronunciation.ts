import fs from "node:fs";
import { r } from "../core/config.ts";

export interface PronEntry {
  term: string;
  say: string;
  caseSensitive?: boolean;
}

export function loadPronunciations(): PronEntry[] {
  try {
    const d = JSON.parse(fs.readFileSync(r("config", "pronunciation.json"), "utf8")) as { entries: PronEntry[] };
    return [...d.entries].sort((a, b) => b.term.length - a.term.length);
  } catch {
    return [];
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Apply the pronunciation dictionary to text that will be spoken (never to captions). */
export function toSpoken(text: string, entries = loadPronunciations()): string {
  let out = text;
  for (const e of entries) {
    if (e.term === e.say) continue;
    // Word boundaries that also work for terms ending in symbols (e.g. "X|S") or digits.
    const re = new RegExp(`(?<![A-Za-z0-9])${esc(e.term)}(?![A-Za-z0-9])`, e.caseSensitive ? "g" : "gi");
    out = out.replace(re, e.say);
  }
  return out;
}

/** Split narration into sentences (keeps the punctuation). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
