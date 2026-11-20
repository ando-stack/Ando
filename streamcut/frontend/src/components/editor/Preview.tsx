"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { EditSpec, Region } from "@/lib/types";

const ASPECT: Record<EditSpec["format"], number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };

/** Ajusta la región al aspecto destino centrada (igual que el render del backend). */
function fitRegion(r: Region, srcAspect: number, target: number): Region {
  let w = r.w * srcAspect, h = r.h; // en unidades de altura del original
  const cx = (r.x + r.w / 2) * srcAspect, cy = r.y + r.h / 2;
  if (w / h > target) w = h * target; else h = w / target;
  const x = Math.min(Math.max(0, cx - w / 2), srcAspect - w);
  const y = Math.min(Math.max(0, cy - h / 2), 1 - h);
  return { x: x / srcAspect, y, w: w / srcAspect, h };
}

export interface TrackPoint { t: number; x: number; y: number }
export interface FaceTrack { main: TrackPoint[]; webcam: TrackPoint[] }

function lerpTrack(track: TrackPoint[], t: number): [number, number] | null {
  if (!track.length) return null;
  if (t <= track[0].t) return [track[0].x, track[0].y];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    if (t >= a.t && t <= b.t) { const k = (t - a.t) / Math.max(1e-6, b.t - a.t); return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k]; }
  }
  const l = track[track.length - 1];
  return [l.x, l.y];
}

/** Igual que el render: la zona (ya ajustada al aspecto) se centra en la cara, sin salirse de `bounds`. */
function follow(region: Region, center: [number, number] | null, srcAspect: number, target: number, bounds?: Region): Region {
  const r = fitRegion(region, srcAspect, target);
  if (!center) return r;
  let b = bounds ?? { x: 0, y: 0, w: 1, h: 1 };
  if (b.w < r.w || b.h < r.h) b = { x: 0, y: 0, w: 1, h: 1 };
  return { ...r, x: Math.min(Math.max(b.x, center[0] - r.w / 2), b.x + b.w - r.w), y: Math.min(Math.max(b.y, center[1] - r.h / 2), b.y + b.h - r.h) };
}

function Cropped({ src, region, aspect, srcAspect, videoRef, muted }: {
  src: string; region: Region; aspect: number; srcAspect: number; videoRef?: React.Ref<HTMLVideoElement>; muted?: boolean;
}) {
  const r = fitRegion(region, srcAspect, aspect);
  // El vídeo se escala para que la región ocupe todo el contenedor
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ aspectRatio: aspect }}>
      <video ref={videoRef} src={src} muted={muted} playsInline preload="auto"
        className="absolute max-w-none"
        style={{ width: `${100 / r.w}%`, height: `${100 / r.h}%`, left: `${(-r.x / r.w) * 100}%`, top: `${(-r.y / r.h) * 100}%` }} />
    </div>
  );
}

export interface PreviewHandle { video: HTMLVideoElement | null }

export const Preview = forwardRef<PreviewHandle, { spec: EditSpec; src: string; srcAspect: number; outTime: number; sourceTime: number; track?: FaceTrack | null }>(
  function Preview({ spec, src, srcAspect, outTime, sourceTime, track }, ref) {
    const main = useRef<HTMLVideoElement>(null);
    const second = useRef<HTMLVideoElement>(null);
    useImperativeHandle(ref, () => ({ get video() { return main.current; } }), []);
    const aspect = ASPECT[spec.format];
    const mode = spec.layout.mode === "split" && !spec.layout.webcam ? "fit_blur" : spec.layout.mode;

    // Sincroniza el segundo vídeo (webcam / fondo) con el principal
    useEffect(() => {
      const a = main.current, b = second.current;
      if (!a || !b) return;
      const sync = () => {
        if (Math.abs(b.currentTime - a.currentTime) > 0.15) b.currentTime = a.currentTime;
        if (a.paused !== b.paused) (a.paused ? b.pause() : b.play().catch(() => undefined));
      };
      const ev = ["play", "pause", "seeked", "timeupdate"];
      ev.forEach((e) => a.addEventListener(e, sync));
      return () => ev.forEach((e) => a.removeEventListener(e, sync));
    }, [mode]);

    const tracking = !!spec.layout.face_track && !!track;
    const splitTop = aspect / spec.layout.split_ratio;
    const mainRegion = tracking && mode === "crop" ? follow(spec.layout.main, lerpTrack(track!.main, sourceTime), srcAspect, aspect) : spec.layout.main;
    const camRegion = spec.layout.webcam && tracking && mode === "split"
      ? follow(spec.layout.webcam, lerpTrack(track!.webcam, sourceTime), srcAspect, splitTop, spec.layout.webcam) : spec.layout.webcam;

    const zoom = spec.zoom.enabled ? spec.zoom.punch_ins.find((p) => outTime >= p.t && outTime <= p.t + p.duration) : undefined;
    const st = spec.subtitles.style;
    const cue = spec.subtitles.enabled ? spec.subtitles.cues.find((c) => sourceTime >= c.start && sourceTime <= c.end) : undefined;
    const scale = 1; // la tipografía se expresa relativa a la altura de la previsualización
    const fontPx = `calc(${(st.size / 1920) * 100 * scale}cqh)`;

    return (
      <div className="relative mx-auto h-full max-h-full overflow-hidden rounded-lg bg-black shadow-2xl"
        style={{ aspectRatio: aspect, containerType: "size" }}>
        <div className="absolute inset-0 transition-transform duration-200" style={{ transform: zoom ? `scale(${zoom.scale})` : undefined }}>
          {mode === "crop" && <Cropped src={src} region={mainRegion} aspect={aspect} srcAspect={srcAspect} videoRef={main} />}
          {mode === "split" && spec.layout.webcam && (
            <div className="flex h-full flex-col">
              <div style={{ height: `${spec.layout.split_ratio * 100}%` }}>
                <Cropped src={src} region={camRegion!} aspect={splitTop} srcAspect={srcAspect} videoRef={second} muted />
              </div>
              <div className="flex-1">
                <Cropped src={src} region={spec.layout.main} aspect={aspect / (1 - spec.layout.split_ratio)} srcAspect={srcAspect} videoRef={main} />
              </div>
            </div>
          )}
          {(mode === "fit_blur" || mode === "fit_black") && (
            <>
              {mode === "fit_blur" && (
                <video ref={second} src={src} muted playsInline className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl brightness-75" />
              )}
              <video ref={main} src={src} playsInline preload="auto" className="absolute inset-0 h-full w-full object-contain" />
            </>
          )}
        </div>
        {cue && (
          <div className="pointer-events-none absolute inset-x-[6%] text-center leading-tight"
            style={{
              [st.position === "top" ? "top" : "bottom"]: st.position === "middle" ? "50%" : `${(st.margin_v / 1920) * 100}%`,
              transform: st.position === "middle" ? "translateY(50%)" : undefined,
              fontFamily: st.font, fontSize: fontPx, fontWeight: st.bold ? 800 : 500, color: st.color,
              textTransform: st.uppercase ? "uppercase" : undefined,
              WebkitTextStroke: `${(st.outline / 1920) * 100 * 0.6}cqh ${st.outline_color}`, paintOrder: "stroke fill",
              textShadow: st.shadow ? `0 ${st.shadow / 10}cqh ${st.shadow / 5}cqh rgba(0,0,0,.7)` : undefined,
            }}>
            {cue.words.length && st.animation !== "none" ? cue.words.map((w, i) => {
              const active = sourceTime >= w.start && (i === cue.words.length - 1 || sourceTime < cue.words[i + 1].start);
              return <span key={i} style={{ color: active ? st.highlight_color : undefined }}>{w.text} </span>;
            }) : cue.text}
          </div>
        )}
      </div>
    );
  },
);
