"use client";

import { Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fmtTime } from "@/lib/format";
import type { Finding, Note } from "@/lib/types";
import { cx } from "../ui";
import { Timeline } from "./Timeline";

export interface PlayerHandle { seek: (t: number, play?: boolean) => void; currentTime: () => number; pause: () => void }

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export const VideoPlayer = forwardRef<PlayerHandle, {
  src: string; duration: number | null; findings: Finding[]; notes: Note[]; selectedId: string | null;
  onTime?: (t: number) => void; onSelect: (f: Finding) => void;
}>(function VideoPlayer({ src, duration, findings, notes, selectedId, onTime, onSelect }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(duration || 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const seek = useCallback((time: number, play = false) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, (v.duration || dur) - 0.05));
    setT(v.currentTime);
    if (play) v.play().catch(() => {});
  }, [dur]);

  useImperativeHandle(ref, () => ({ seek, currentTime: () => video.current?.currentTime || 0, pause: () => video.current?.pause() }), [seek]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft" || e.key === "j") { e.preventDefault(); seek((video.current?.currentTime || 0) - (e.key === "j" ? 10 : 5)); }
      else if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); seek((video.current?.currentTime || 0) + (e.key === "l" ? 10 : 5)); }
      else if (e.key === ",") seek((video.current?.currentTime || 0) - 1 / 30);
      else if (e.key === ".") seek((video.current?.currentTime || 0) + 1 / 30);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toggle, seek]);

  return (
    <div ref={box} className="overflow-hidden rounded-xl border border-line bg-black">
      <div className="relative aspect-video bg-black">
        <video
          ref={video} src={src} className="absolute inset-0 size-full" playsInline preload="metadata" onClick={toggle}
          onTimeUpdate={(e) => { const c = e.currentTarget.currentTime; setT(c); onTime?.(c); }}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setErr("No se pudo reproducir el vídeo en este navegador.")}
        />
        {err && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-2">{err}</div>}
      </div>
      <div className="space-y-3 border-t border-line bg-surface px-3 pb-3 pt-1 sm:px-4">
        <Timeline duration={dur} current={t} findings={findings} notes={notes} selectedId={selectedId} onSeek={(x) => seek(x)} onSelect={onSelect} />
        <div className="flex flex-wrap items-center gap-1">
          <IconBtn label="Retroceder 10 s (J)" onClick={() => seek(t - 10)}><RotateCcw className="size-4" /></IconBtn>
          <IconBtn label={playing ? "Pausa (espacio)" : "Reproducir (espacio)"} onClick={toggle} primary>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</IconBtn>
          <IconBtn label="Avanzar 10 s (L)" onClick={() => seek(t + 10)}><RotateCw className="size-4" /></IconBtn>
          <span className="tabular ml-2 font-mono text-xs text-ink-2">{fmtTime(t, true)} <span className="text-ink-3">/ {fmtTime(dur)}</span></span>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label="Velocidad">
              {SPEEDS.map((s) => (
                <button key={s} onClick={() => { setSpeed(s); if (video.current) video.current.playbackRate = s; }}
                  className={cx("focus-ring tabular rounded-md px-2 py-1 text-xs font-medium", speed === s ? "bg-brand text-white" : "text-ink-3 hover:text-ink")}>{s}x</button>
              ))}
            </div>
            <IconBtn label={muted ? "Activar sonido" : "Silenciar"} onClick={() => { setMuted(!muted); if (video.current) video.current.muted = !muted; }}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconBtn>
            <IconBtn label="Pantalla completa" onClick={() => box.current?.requestFullscreen?.()}><Maximize className="size-4" /></IconBtn>
          </div>
        </div>
      </div>
    </div>
  );
});

function IconBtn({ children, label, onClick, primary }: { children: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={cx("focus-ring grid size-9 place-items-center rounded-lg transition-colors", primary ? "bg-brand text-white hover:bg-brand-strong" : "text-ink-2 hover:bg-surface-3 hover:text-ink")}>
      {children}
    </button>
  );
}
