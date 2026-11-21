"use client";

import { useRef, useState } from "react";
import { SEVERITY_COLOR, fmtTime } from "@/lib/format";
import type { Finding, Note } from "@/lib/types";
import { cx } from "../ui";

/** Scrubbable timeline with severity-coloured markers (findings) and note ticks. */
export function Timeline({ duration, current, findings, notes, selectedId, onSeek, onSelect }: {
  duration: number; current: number; findings: Finding[]; notes: Note[]; selectedId: string | null;
  onSeek: (t: number) => void; onSelect: (f: Finding) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const d = Math.max(duration, 1);

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    return { x, t: (x / r.width) * d };
  };

  return (
    <div className="select-none">
      <div className="relative h-7">
        {findings.map((f) => (
          <button key={f.id} onClick={() => onSelect(f)} title={`${fmtTime(f.t_start)} · ${f.title}`} aria-label={`Error en ${fmtTime(f.t_start)}: ${f.title}`}
            className={cx("absolute bottom-0 -translate-x-1/2 rounded-t-sm transition-all hover:h-6", selectedId === f.id ? "h-7 w-1.5" : "h-4 w-1")}
            style={{ left: `${(100 * f.t_start) / d}%`, background: SEVERITY_COLOR[f.severity], boxShadow: "0 0 0 1px var(--color-surface)" }} />
        ))}
      </div>
      <div
        ref={ref}
        className="relative h-3 cursor-pointer rounded-full bg-surface-3"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); onSeek(tAt(e.clientX).t); }}
        onPointerMove={(e) => { const p = tAt(e.clientX); setHover(p); if (drag) onSeek(p.t); }}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => setHover(null)}
        role="slider" aria-label="Línea temporal" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(current)} tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowRight") onSeek(Math.min(d, current + 5)); if (e.key === "ArrowLeft") onSeek(Math.max(0, current - 5)); }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand/80" style={{ width: `${(100 * current) / d}%` }} />
        {findings.filter((f) => f.t_end && f.t_end > f.t_start).map((f) => (
          <div key={f.id} className="pointer-events-none absolute inset-y-0 opacity-40" style={{ left: `${(100 * f.t_start) / d}%`, width: `${(100 * (f.t_end! - f.t_start)) / d}%`, background: SEVERITY_COLOR[f.severity] }} />
        ))}
        {notes.filter((n) => n.t != null).map((n) => (
          <div key={n.id} className="pointer-events-none absolute -bottom-2 size-1.5 -translate-x-1/2 rounded-full bg-ink-2" style={{ left: `${(100 * n.t!) / d}%` }} title={n.text} />
        ))}
        <div className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow" style={{ left: `${(100 * current) / d}%` }} />
        {hover && (
          <div className="tabular pointer-events-none absolute -top-9 -translate-x-1/2 rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px]" style={{ left: hover.x }}>{fmtTime(hover.t)}</div>
        )}
      </div>
    </div>
  );
}
