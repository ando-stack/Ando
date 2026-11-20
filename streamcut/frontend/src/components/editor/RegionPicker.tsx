"use client";

import { useEffect, useRef } from "react";
import type { Region } from "@/lib/types";

export interface PickerBox { key: string; label: string; color: string; region: Region }

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/**
 * Fotograma del vídeo original con las zonas dibujadas encima. Cada zona se mueve arrastrándola
 * y se cambia de tamaño con la esquina inferior derecha.
 */
export function RegionPicker({ src, time, srcAspect, boxes, onChange }: {
  src: string; time: number; srcAspect: number; boxes: PickerBox[];
  onChange: (key: string, r: Region, final: boolean) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ key: string; mode: "move" | "resize"; x0: number; y0: number; r0: Region; last: Region } | null>(null);

  // Muestra el fotograma del cabezal (con un pequeño retardo para no saturar al reproducir)
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const id = setTimeout(() => { if (Math.abs(v.currentTime - time) > 0.25) v.currentTime = time; }, 150);
    return () => clearTimeout(id);
  }, [time]);

  const start = (e: React.PointerEvent, key: string, mode: "move" | "resize", r: Region) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { key, mode, x0: e.clientX, y0: e.clientY, r0: r, last: r };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current, el = wrap.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - d.x0) / rect.width, dy = (e.clientY - d.y0) / rect.height;
    const r = d.r0;
    const next = d.mode === "move"
      ? { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }
      : { ...r, w: clamp(r.w + dx, 0.05, 1 - r.x), h: clamp(r.h + dy, 0.05, 1 - r.y) };
    const rounded = { x: +next.x.toFixed(4), y: +next.y.toFixed(4), w: +next.w.toFixed(4), h: +next.h.toFixed(4) };
    d.last = rounded;
    onChange(d.key, rounded, false);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d) onChange(d.key, d.last, true);
  };

  return (
    <div ref={wrap} className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: srcAspect }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <video ref={video} src={src} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" />
      {boxes.map((b) => (
        <div key={b.key} role="group" aria-label={b.label}
          className="absolute cursor-move rounded-sm border-2"
          style={{ left: `${b.region.x * 100}%`, top: `${b.region.y * 100}%`, width: `${b.region.w * 100}%`,
            height: `${b.region.h * 100}%`, borderColor: b.color, background: `${b.color}22` }}
          onPointerDown={(e) => start(e, b.key, "move", b.region)}>
          <span className="pointer-events-none absolute left-0 top-0 rounded-br px-1 text-[10px] font-semibold text-white"
            style={{ background: b.color }}>{b.label}</span>
          <span aria-label={`Cambiar tamaño de ${b.label}`}
            className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white"
            style={{ background: b.color }} onPointerDown={(e) => start(e, b.key, "resize", b.region)} />
        </div>
      ))}
    </div>
  );
}
