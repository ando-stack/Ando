import type { WhisperWord } from "./whisper.ts";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ONES[n % 10] : "");
  if (n >= 1000 && n < 10000) return numWords(Math.floor(n / 100)) + numWords(n % 100);
  return String(n);
}

/** Letters-only form used to compare what was said with what was heard. */
export function normSpoken(s: string): string {
  return s
    .toLowerCase()
    .replace(/\d+/g, (d) => numWords(Number(d)))
    .replace(/[^a-z]/g, "");
}

/** Piecewise-linear monotonic interpolation over (x, y) points. */
function interp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

/**
 * Align spoken groups of one sentence to time.
 * Both the script and whisper's transcript describe the same audio, so their
 * character-progress curves line up even when tokenization differs
 * ("G T A six" vs "GTA 6"). Exact speech start/end come from the TTS audio itself.
 */
export function alignSentence(
  groupsSpoken: string[],
  sentStart: number,
  sentEnd: number,
  heard: WhisperWord[],
): { start: number; end: number }[] {
  const lens = groupsSpoken.map((g) => Math.max(1, normSpoken(g).length));
  const total = lens.reduce((a, b) => a + b, 0);

  const points: [number, number][] = [[0, sentStart]];
  const inside = heard.filter((w) => (w.start + w.end) / 2 >= sentStart - 0.15 && (w.start + w.end) / 2 <= sentEnd + 0.15);
  if (inside.length >= 2) {
    const hl = inside.map((w) => Math.max(1, normSpoken(w.text).length));
    const htotal = hl.reduce((a, b) => a + b, 0);
    let acc = 0;
    inside.forEach((w, k) => {
      const fs = acc / htotal;
      acc += hl[k];
      const fe = acc / htotal;
      if (k > 0) points.push([fs, Math.max(sentStart, Math.min(sentEnd, w.start))]);
      if (k < inside.length - 1) points.push([fe, Math.max(sentStart, Math.min(sentEnd, w.end))]);
    });
  }
  points.push([1, sentEnd]);
  // Enforce monotonic x and y.
  points.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < points.length; i++) points[i][1] = Math.max(points[i][1], points[i - 1][1]);

  let acc = 0;
  return lens.map((l) => {
    const fs = acc / total;
    acc += l;
    const fe = acc / total;
    return { start: interp(points, fs), end: interp(points, fe) };
  });
}
