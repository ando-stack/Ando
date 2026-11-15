import { getConfig } from "../core/config.ts";
import type { CaptionPage, WordTiming } from "../core/types.ts";

/**
 * Group words into caption "pages" of 1–N words. Breaks on: max words, max chars,
 * sentence end, segment change, or a pause in speech. Pages never overlap.
 */
export function buildPages(words: WordTiming[], opts?: { maxWords?: number; maxChars?: number }): CaptionPage[] {
  const c = getConfig().captions;
  const maxWords = opts?.maxWords ?? c.maxWordsPerPage;
  const maxChars = opts?.maxChars ?? c.maxCharsPerPage;
  const pages: CaptionPage[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (cur.length) pages.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || chars > maxChars || w.segId !== prev.segId || w.start - prev.end > 0.35)) flush();
    cur.push(w);
    if (w.brk || /[.!?]$/.test(w.text)) flush();
  }
  flush();
  // Hold each page until the next one starts (max +0.5s), so text doesn't flicker off between words.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    pages[i].end = next ? Math.min(next.start, pages[i].end + 0.5) : pages[i].end + 0.4;
  }
  return pages;
}
