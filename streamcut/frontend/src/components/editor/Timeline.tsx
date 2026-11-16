"use client";

import { useEffect, useRef, useState } from "react";
import { fmtTimecode } from "@/lib/format";
import type { Segment } from "@/lib/types";

interface Props {
  start: number; // inicio visible (s, tiempo del original)
  end: number;
  peaks: number[] | null;
  peaksPerSecond: number;
  segments: Segment[];
  selected: number;
  time: number;
  onSeek: (t: number) => void;
  onSelect: (i: number) => void;
  onSegmentsChange: (segs: Segment[], final: boolean) => void;
}

/** Línea de tiempo con forma de onda: segmentos arrastrables (recorte), cabezal y selección. */
export function Timeline({ start, end, peaks, peaksPerSecond, segments, selected, time, onSeek, onSelect, onSegmentsChange }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ i: number; edge: "start" | "end" | "move"; x0: number; seg: Segment } | null>(null);
  const span = Math.max(1, end - start);
  const toX = (t: number) => ((t - start) / span) * width;
  const toT = (x: number) => start + (x / width) * span;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 64;
    c.width = width * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, h);
    if (!peaks) return;
    const styles = getComputedStyle(document.documentElement);
    ctx.fillStyle = styles.getPropertyValue("--color-line-strong") || "#383d4a";
    for (let x = 0; x < width; x += 2) {
      const t = toT(x);
      const i0 = Math.floor(t * peaksPerSecond);
      const i1 = Math.max(i0 + 1, Math.floor(toT(x + 2) * peaksPerSecond));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) m = Math.max(m, peaks[i] ?? 0);
      const bh = Math.max(1, m * (h - 6));
      ctx.fillRect(x, (h - bh) / 2, 1.4, bh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, width, start, end, peaksPerSecond]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dt = ((e.clientX - d.x0) / width) * span;
      const segs = segments.map((s) => ({ ...s }));
      const s = segs[d.i];
      const prevEnd = d.i > 0 ? segs[d.i - 1].end : 0;
      const nextStart = d.i < segs.length - 1 ? segs[d.i + 1].start : Infinity;
      if (d.edge === "start") s.start = Math.min(d.seg.end - 0.3, Math.max(prevEnd, Math.max(0, d.seg.start + dt)));
      else if (d.edge === "end") s.end = Math.max(d.seg.start + 0.3, Math.min(nextStart, d.seg.end + dt));
      else {
        const len = d.seg.end - d.seg.start;
        const ns = Math.min(Math.max(prevEnd, d.seg.start + dt), nextStart - len);
        s.start = ns; s.end = ns + len;
      }
      s.start = Math.round(s.start * 100) / 100;
      s.end = Math.round(s.end * 100) / 100;
      onSegmentsChange(segs, false);
    };
    const up = () => {
      if (drag.current) { drag.current = null; onSegmentsChange(segments, true); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [segments, width, span, onSegmentsChange]);

  const ticks: number[] = [];
  const step = span > 120 ? 15 : span > 60 ? 10 : 5;
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);

  return (
    <div className="select-none">
      <div ref={wrap} className="relative h-24 cursor-text overflow-hidden rounded-lg border border-line bg-panel-2"
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "CANVAS") onSeek(toT(e.nativeEvent.offsetX)); }}>
        <canvas ref={canvas} className="pointer-events-auto absolute left-0 top-4 h-16 w-full" />
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute top-0 h-full border-l border-line/60" style={{ left: toX(t) }}>
            <span className="ml-1 text-[9px] text-faint">{fmtTimecode(t).replace(/\.\d+$/, "")}</span>
          </div>
        ))}
        {segments.map((s, i) => (
          <div key={i} role="button" tabIndex={0} aria-label={`Segmento ${i + 1}`}
            className={`absolute top-4 h-16 rounded-md border ${i === selected ? "border-accent-soft bg-accent/25" : "border-accent/50 bg-accent/12"}`}
            style={{ left: toX(s.start), width: Math.max(4, toX(s.end) - toX(s.start)) }}
            onPointerDown={(e) => { e.stopPropagation(); onSelect(i); drag.current = { i, edge: "move", x0: e.clientX, seg: { ...s } }; }}>
            <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md bg-accent-soft/80"
              onPointerDown={(e) => { e.stopPropagation(); onSelect(i); drag.current = { i, edge: "start", x0: e.clientX, seg: { ...s } }; }} />
            <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-accent-soft/80"
              onPointerDown={(e) => { e.stopPropagation(); onSelect(i); drag.current = { i, edge: "end", x0: e.clientX, seg: { ...s } }; }} />
            <span className="pointer-events-none absolute left-3 top-1 text-[10px] font-medium text-fg/80">{(s.end - s.start).toFixed(1)} s</span>
          </div>
        ))}
        <div className="pointer-events-none absolute top-0 h-full w-px bg-white" style={{ left: toX(time) }}>
          <div className="-ml-1.5 h-2 w-3 rounded-b bg-white" />
        </div>
      </div>
    </div>
  );
}
