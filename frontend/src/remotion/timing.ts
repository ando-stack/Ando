import type {Project, Segment} from '../types';

export interface Span {
  seg: Segment;
  start: number; // tiempo de salida
  end: number;
  index: number;
}

export function segmentSpans(p: Project): Span[] {
  const out: Span[] = [];
  let t = 0;
  p.segments.forEach((seg, index) => {
    const d = seg.outPoint - seg.inPoint;
    out.push({seg, start: t, end: t + d, index});
    t += d;
  });
  return out;
}

export function projectDuration(p: Project): number {
  return p.segments.reduce((a, s) => a + (s.outPoint - s.inPoint), 0);
}

export function spanAt(spans: Span[], t: number): Span | null {
  for (const s of spans) if (t >= s.start && t < s.end) return s;
  return spans.length && Math.abs(t - spans[spans.length - 1].end) < 1e-3 ? spans[spans.length - 1] : null;
}

export function sourceToOutput(p: Project, sourceId: string, t: number): number | null {
  for (const s of segmentSpans(p)) {
    if (s.seg.sourceId === sourceId && t >= s.seg.inPoint - 1e-6 && t <= s.seg.outPoint + 1e-6) {
      return s.start + (t - s.seg.inPoint);
    }
  }
  return null;
}

export function sourceRangeToOutput(p: Project, sourceId: string, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segmentSpans(p)) {
    if (s.seg.sourceId !== sourceId) continue;
    const x = Math.max(a, s.seg.inPoint);
    const y = Math.min(b, s.seg.outPoint);
    if (y > x) out.push([s.start + x - s.seg.inPoint, s.start + y - s.seg.inPoint]);
  }
  return out;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
