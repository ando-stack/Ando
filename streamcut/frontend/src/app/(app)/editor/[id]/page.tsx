"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Captions, Combine, Crop, Download, Film, Pause, Play, Plus, Redo2, RotateCcw, Save, Scissors, ScanFace,
  Trash2, Undo2, Volume2, Wand2, ZoomIn,
} from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipStatus } from "@/components/ClipCard";
import { type FaceTrack, Preview, type PreviewHandle } from "@/components/editor/Preview";
import { RegionPicker } from "@/components/editor/RegionPicker";
import { Timeline } from "@/components/editor/Timeline";
import { Badge, Card, Field, Progress, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, get, post } from "@/lib/api";
import { cn, fmtDate, fmtTimecode, JOB_STATUS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Clip, ClipDetail, Cue, EditSpec, Region, Segment, Word } from "@/lib/types";

interface EditState {
  clip: Clip; spec: EditSpec; head_seq: number; operations: number; dirty: boolean;
  source: { id: string; title: string; duration: number; width: number; height: number; video_url: string;
    waveform_url: string | null; context_start: number; context_end: number; webcam_region: Region | null };
  words: Word[];
}

function cuesFromWords(words: Word[], segs: Segment[], perLine: number): Cue[] {
  const a = Math.min(...segs.map((s) => s.start)), b = Math.max(...segs.map((s) => s.end));
  const cues: Cue[] = [];
  let g: Word[] = [];
  const flush = () => { if (g.length) cues.push({ start: g[0].start, end: g[g.length - 1].end, text: g.map((w) => w.text.trim()).join(" "), words: g.map((w) => ({ ...w, text: w.text.trim() })) }); g = []; };
  for (const w of words) {
    if (w.end <= a || w.start >= b || !w.text.trim()) continue;
    if (g.length && w.start - g[g.length - 1].end > 0.8) flush();
    g.push(w);
    const txt = g.map((x) => x.text.trim()).join(" ");
    if (g.length >= perLine || txt.length >= 24 || /[.?!,]$/.test(w.text.trim())) flush();
  }
  flush();
  return cues;
}

/** Tiempo de salida ↔ tiempo del original según los segmentos. */
function outToSource(segs: Segment[], t: number): number {
  let acc = 0;
  for (const s of segs) { const d = s.end - s.start; if (t <= acc + d) return s.start + (t - acc); acc += d; }
  return segs[segs.length - 1].end;
}
function sourceToOut(segs: Segment[], t: number): number | null {
  let acc = 0;
  for (const s of segs) { if (t >= s.start && t <= s.end) return acc + t - s.start; acc += s.end - s.start; }
  return null;
}

function RegionEditor({ label, region, onChange }: { label: string; region: Region; onChange: (r: Region, final: boolean) => void }) {
  return (
    <div className="space-y-2">
      <div className="label">{label}</div>
      {(["x", "y", "w", "h"] as const).map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className="w-16 text-muted">{{ x: "Horizontal", y: "Vertical", w: "Ancho", h: "Alto" }[k]}</span>
          <input type="range" min={k === "w" || k === "h" ? 0.05 : 0} max={1} step={0.01} value={region[k]}
            className="flex-1 accent-[var(--color-accent)]" aria-label={`${label} ${k}`}
            onChange={(e) => onChange({ ...region, [k]: +e.target.value }, false)}
            onPointerUp={() => onChange(region, true)} onKeyUp={() => onChange(region, true)} />
          <span className="w-9 text-right tabular-nums text-faint">{Math.round(region[k] * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const state = useQuery({ queryKey: ["edit", id], queryFn: () => get<EditState>(`/clips/${id}/edit`), staleTime: Infinity, retry: false });
  const detail = useQuery({ queryKey: ["clip", id], queryFn: () => get<ClipDetail>(`/clips/${id}`), refetchInterval: 6000 });
  const waveform = useQuery({
    queryKey: ["waveform", state.data?.source.waveform_url],
    queryFn: () => fetch(state.data!.source.waveform_url!).then((r) => r.json()) as Promise<{ peaks_per_second: number; peaks: number[] }>,
    enabled: !!state.data?.source.waveform_url, staleTime: Infinity,
  });

  const [spec, setSpec] = useState<EditSpec | null>(null);
  const [past, setPast] = useState<EditSpec[]>([]);
  const [future, setFuture] = useState<EditSpec[]>([]);
  const [seq, setSeq] = useState(0);
  const [tab, setTab] = useState<"frame" | "subs" | "fx" | "audio" | "versions">("frame");
  const [sel, setSel] = useState(0);
  const [time, setTime] = useState(0); // tiempo del original
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<"idle" | "syncing" | "error">("idle");
  const preview = useRef<PreviewHandle>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const seqRef = useRef(0);
  const committed = useRef<EditSpec | null>(null);
  const initialSeek = useRef(false);

  const trackKey = spec ? JSON.stringify([spec.layout.mode, spec.layout.webcam, spec.segments]) : "";
  const faceTrack = useQuery({
    queryKey: ["face-track", id, trackKey],
    queryFn: () => get<FaceTrack & { frames: number; frames_with_face: number }>(`/clips/${id}/face-track`),
    enabled: !!spec?.layout.face_track && (spec.layout.mode === "crop" || spec.layout.mode === "split"),
    staleTime: Infinity, retry: false, placeholderData: (prev) => prev,
  });

  const autoFrame = useMutation({
    mutationFn: () => get<{ mode: EditSpec["layout"]["mode"]; webcam: (Region & { confidence?: number }) | null; face_track: boolean; frames_with_face: number }>(`/clips/${id}/auto-frame`),
    onSuccess: (r) => {
      apply("auto_frame", (s) => {
        s.layout = { ...s.layout, mode: r.mode, main: { x: 0, y: 0, w: 1, h: 1 }, face_track: r.face_track,
          webcam: r.webcam ? { x: r.webcam.x, y: r.webcam.y, w: r.webcam.w, h: r.webcam.h } : s.layout.webcam };
        return s;
      });
      toast(r.mode === "split" ? "Webcam encontrada: cara arriba y gameplay abajo" : r.mode === "crop" ? "Encuadre vertical siguiendo la cara" : "No se ve ninguna cara: vídeo completo con fondo difuminado", r.mode === "fit_blur" ? "info" : "ok");
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : "No se pudo analizar el vídeo", "error"),
  });

  useEffect(() => {
    if (state.data && !spec) {
      setSpec(state.data.spec);
      committed.current = state.data.spec;
      setSeq(state.data.head_seq);
      seqRef.current = state.data.head_seq;
      setTime(state.data.spec.segments[0].start);
    }
  }, [state.data, spec]);

  /** Guarda en el servidor la operación (cola secuencial para respetar el número de secuencia). */
  const persist = useCallback((op: string, next: EditSpec, payload: Record<string, unknown> = {}) => {
    setSaving("syncing");
    chain.current = chain.current.then(async () => {
      try {
        const r = await post<{ head_seq: number }>(`/clips/${id}/edit/ops`, { op_type: op, payload, spec: next, base_seq: seqRef.current });
        seqRef.current = r.head_seq;
        setSeq(r.head_seq);
        setSaving("idle");
      } catch (e) {
        setSaving("error");
        toast(e instanceof ApiError ? `No se pudo guardar: ${e.message}` : "No se pudo guardar", "error");
        if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["edit", id] });
      }
    });
  }, [id, qc, toast]);

  /** Aplica un cambio. `final=false` solo actualiza la vista (arrastres); `final=true` crea un paso de historial. */
  const apply = useCallback((op: string, fn: (s: EditSpec) => EditSpec, final = true) => {
    setSpec((cur) => {
      if (!cur) return cur;
      const next = fn(structuredClone(cur));
      if (final) {
        if (committed.current) setPast((p) => [...p.slice(-99), committed.current!]);
        setFuture([]);
        committed.current = next;
        persist(op, next);
      }
      return next;
    });
  }, [persist]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length || !committed.current) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [committed.current!, ...f]);
      committed.current = prev;
      setSpec(prev);
      persist("undo", prev);
      return p.slice(0, -1);
    });
  }, [persist]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length || !committed.current) return f;
      const nxt = f[0];
      setPast((p) => [...p, committed.current!]);
      committed.current = nxt;
      setSpec(nxt);
      persist("redo", nxt);
      return f.slice(1);
    });
  }, [persist]);

  // Reproducción respetando los segmentos (salta los huecos y para al final)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = preview.current?.video;
      if (v && spec && !initialSeek.current && v.readyState >= 1) {
        initialSeek.current = true;
        v.currentTime = spec.segments[0].start; // el cabezal empieza en el inicio del clip
      }
      if (v && spec) {
        const t = v.currentTime;
        const segs = spec.segments;
        if (!v.paused) {
          const inside = segs.findIndex((s) => t >= s.start - 0.05 && t < s.end);
          if (inside === -1) {
            const next = segs.find((s) => s.start > t);
            if (next) v.currentTime = next.start; else { v.pause(); v.currentTime = segs[0].start; }
          }
        }
        setTime(v.currentTime);
        setPlaying(!v.paused);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec]);

  const seek = (t: number) => { const v = preview.current?.video; if (v) v.currentTime = t; setTime(t); };
  const toggle = () => {
    const v = preview.current?.video;
    if (!v || !spec) return;
    if (v.paused) {
      if (sourceToOut(spec.segments, v.currentTime) === null) v.currentTime = spec.segments[0].start;
      v.play().catch(() => undefined);
    } else v.pause();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.code === "Space") { e.preventDefault(); toggle(); }
      else if (e.key.toLowerCase() === "s" && !e.ctrlKey) splitAtPlayhead();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = useMutation({
    mutationFn: () => chain.current.then(() => post<{ clip: ClipDetail }>(`/clips/${id}/edit/save`, { note: "Edición manual" })),
    onSuccess: () => { toast("Nueva versión guardada. Renderizando el MP4…", "ok"); qc.invalidateQueries({ queryKey: ["clip", id] }); qc.invalidateQueries({ queryKey: ["clips"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const activate = useMutation({
    mutationFn: (vid: string) => post(`/clips/${id}/versions/${vid}/activate`),
    onSuccess: async () => {
      const r = await post<{ head_seq: number; spec: EditSpec }>(`/clips/${id}/edit/reset`);
      seqRef.current = r.head_seq; setSeq(r.head_seq); committed.current = r.spec; setSpec(r.spec); setPast([]); setFuture([]);
      qc.invalidateQueries({ queryKey: ["clip", id] });
    },
  });

  const splitAtPlayhead = () => {
    if (!spec) return;
    const i = spec.segments.findIndex((s) => time > s.start + 0.25 && time < s.end - 0.25);
    if (i === -1) { toast("Coloca el cabezal dentro de un segmento para dividirlo", "info"); return; }
    apply("split", (s) => { const g = s.segments[i]; s.segments.splice(i, 1, { start: g.start, end: +time.toFixed(2) }, { start: +time.toFixed(2), end: g.end }); return s; });
  };

  const src = state.data?.source;
  const outDur = useMemo(() => spec?.segments.reduce((a, s) => a + s.end - s.start, 0) ?? 0, [spec]);
  const outTime = spec ? sourceToOut(spec.segments, time) ?? 0 : 0;
  const latestExport = detail.data?.exports?.[0];

  if (state.isError) return (
    <div className="space-y-3"><Link href="/editor" className="btn-ghost"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <p className="text-sm text-danger">{(state.error as Error).message}</p></div>
  );
  if (!spec || !src) return <div className="grid h-80 place-items-center"><Spinner className="h-6 w-6" /></div>;
  const ctxStart = Math.min(src.context_start, ...spec.segments.map((s) => s.start - 5));
  const ctxEnd = Math.max(src.context_end, ...spec.segments.map((s) => s.end + 5));
  const srcAspect = (src.width || 16) / (src.height || 9);
  const st = spec.subtitles.style;
  const setStyle = (k: keyof typeof st, v: unknown, final = true) => apply(`subtitle_style:${k}`, (s) => { (s.subtitles.style as any)[k] = v; return s; }, final);

  return (
    <div className="flex flex-col gap-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/editor" className="btn-icon" aria-label="Volver"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h1 className="truncate text-lg font-semibold">{detail.data?.title ?? state.data!.clip.title}</h1>{detail.data && <ClipStatus status={detail.data.status} />}</div>
          <p className="text-xs text-muted">Fuente: {src.title} · edición no destructiva · el original nunca se modifica</p>
        </div>
        <span className="text-xs text-faint">{saving === "syncing" ? "Guardando…" : saving === "error" ? "Error al guardar" : `Guardado · ${seq} operaciones`}</span>
        <button className="btn-icon" onClick={undo} disabled={!past.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><Undo2 className="h-4 w-4" /></button>
        <button className="btn-icon" onClick={redo} disabled={!future.length} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer"><Redo2 className="h-4 w-4" /></button>
        {detail.data?.download_url && <a className="btn-secondary" href={detail.data.download_url} download><Download className="h-4 w-4" />Descargar</a>}
        <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Spinner /> : <Save className="h-4 w-4" />}Guardar y exportar</button>
      </div>
      {latestExport && ["queued", "running"].includes(latestExport.status) && (
        <Card className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <Film className="h-4 w-4 text-accent-soft" /><span className="shrink-0">Renderizando versión {detail.data?.version}: {latestExport.stage ?? JOB_STATUS[latestExport.status]}</span>
          <Progress value={latestExport.progress} className="flex-1" />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card className="grid h-[min(62dvh,640px)] place-items-center bg-[radial-gradient(ellipse_at_center,#1b1e25,#0d0e11)] p-4">
            <Preview ref={preview} spec={spec} src={src.video_url} srcAspect={srcAspect} outTime={outTime} sourceTime={time} track={faceTrack.data} />
          </Card>
          <Card className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary h-9 w-9 px-0" onClick={toggle} aria-label={playing ? "Pausa" : "Reproducir"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}</button>
              <span className="font-mono text-xs tabular-nums text-muted">{fmtTimecode(outTime)} / {fmtTimecode(outDur)}</span>
              <span className="text-xs text-faint">(original {fmtTimecode(time)})</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button className="btn-secondary h-8 text-xs" onClick={splitAtPlayhead} title="Dividir en el cabezal (S)"><Scissors className="h-3.5 w-3.5" />Dividir</button>
                <button className="btn-secondary h-8 text-xs" disabled={sel >= spec.segments.length - 1}
                  onClick={() => apply("join", (s) => { const a = s.segments[sel], b = s.segments[sel + 1]; s.segments.splice(sel, 2, { start: a.start, end: b.end }); return s; })}
                  title="Unir con el siguiente segmento (recupera el hueco)"><Combine className="h-3.5 w-3.5" />Unir</button>
                <button className="btn-secondary h-8 text-xs" disabled={spec.segments.length <= 1}
                  onClick={() => { apply("delete_segment", (s) => { s.segments.splice(sel, 1); return s; }); setSel(0); }}><Trash2 className="h-3.5 w-3.5" />Quitar segmento</button>
                <button className="btn-ghost h-8 text-xs" onClick={() => apply("trim_start_here", (s) => { const g = s.segments[sel]; if (time < g.end - 0.3) g.start = +time.toFixed(2); return s; })}>Inicio aquí</button>
                <button className="btn-ghost h-8 text-xs" onClick={() => apply("trim_end_here", (s) => { const g = s.segments[sel]; if (time > g.start + 0.3) g.end = +time.toFixed(2); return s; })}>Final aquí</button>
              </div>
            </div>
            <Timeline start={Math.max(0, ctxStart)} end={Math.min(src.duration, ctxEnd)} peaks={waveform.data?.peaks ?? null}
              peaksPerSecond={waveform.data?.peaks_per_second ?? 20} segments={spec.segments} selected={sel} time={time}
              onSeek={seek} onSelect={setSel}
              onSegmentsChange={(segs, final) => apply("trim", (s) => { s.segments = segs; return s; }, final)} />
            <p className="text-[11px] text-faint">Arrastra los bordes de un segmento para recortar, o su centro para desplazarlo. Espacio: reproducir · S: dividir · Ctrl+Z / Ctrl+Shift+Z: deshacer / rehacer.</p>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="flex border-b border-line text-xs">
            {([["frame", <Crop key="i" className="h-3.5 w-3.5" />, "Encuadre"], ["subs", <Captions key="i" className="h-3.5 w-3.5" />, "Subtítulos"],
              ["fx", <ZoomIn key="i" className="h-3.5 w-3.5" />, "Efectos"], ["audio", <Volume2 key="i" className="h-3.5 w-3.5" />, "Audio"],
              ["versions", <Film key="i" className="h-3.5 w-3.5" />, "Versiones"]] as const).map(([k, icon, label]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("flex flex-1 flex-col items-center gap-1 border-b-2 py-2.5", tab === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>{icon}{label}</button>
            ))}
          </div>
          <div className="max-h-[calc(62dvh+170px)] space-y-4 overflow-auto p-4">
            {tab === "frame" && (<>
              <div className="space-y-1.5" role="group" aria-label="Formato">
                <span className="label">Formato</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["9:16", "1:1", "16:9"] as const).map((f) => (
                    <button key={f} onClick={() => apply("format", (s) => { s.format = f; return s; })}
                      className={cn("rounded-lg border py-2 text-xs", spec.format === f ? "border-accent bg-accent-bg text-fg" : "border-line text-muted")}>
                      {f}<div className="text-[10px] text-faint">{f === "9:16" ? "Vertical" : f === "1:1" ? "Cuadrado" : "Horizontal"}</div></button>
                  ))}
                </div>
              </div>
              <Field label="Composición">
                <Select value={spec.layout.mode} onChange={(v) => apply("layout_mode", (s) => { s.layout.mode = v as EditSpec["layout"]["mode"]; if (v === "split" && !s.layout.webcam) s.layout.webcam = src.webcam_region ?? { x: 0.7, y: 0.05, w: 0.28, h: 0.3 }; return s; })}
                  options={[{ value: "fit_blur", label: "Completo con fondo difuminado" }, { value: "crop", label: "Reencuadre (recorte)" },
                    { value: "split", label: "Pantalla dividida (cara arriba + gameplay abajo)" }, { value: "fit_black", label: "Completo con bandas" }]} />
              </Field>
              <button className="btn-secondary w-full" disabled={autoFrame.isPending} onClick={() => autoFrame.mutate()}>
                {autoFrame.isPending ? <Spinner /> : <Wand2 className="h-4 w-4" />}{autoFrame.isPending ? "Buscando la cara…" : "Encuadre automático"}</button>
              <p className="text-[11px] text-faint">Si hay una webcam en el vídeo: cara arriba y gameplay abajo. Si no: vertical que sigue la cara.</p>
              {(spec.layout.mode === "crop" || spec.layout.mode === "split") && (
                <div className="space-y-1">
                  <Toggle checked={!!spec.layout.face_track} onChange={(v) => apply("face_track", (s) => { s.layout.face_track = v; return s; })}
                    label={<span className="inline-flex items-center gap-1.5"><ScanFace className="h-4 w-4" />Seguimiento de cara</span>} />
                  {spec.layout.face_track && (
                    <p className="pl-11 text-[11px] text-faint">
                      {faceTrack.isFetching ? "Buscando la cara en el clip…" : faceTrack.isError ? "No se pudo analizar el vídeo." :
                        faceTrack.data && !(spec.layout.mode === "split" ? faceTrack.data.webcam : faceTrack.data.main).length
                          ? (spec.layout.mode === "split" ? "No veo una cara dentro de la zona de la webcam: ajusta el recuadro azul." : "No se ve una cara clara en este clip: el encuadre se queda fijo.")
                          : spec.layout.mode === "split" ? "La parte de arriba sigue a la cara dentro de la webcam." : "El encuadre sigue a la cara durante todo el clip."}
                    </p>
                  )}
                </div>
              )}
              {spec.layout.mode !== "fit_black" && (
                <div className="space-y-1.5">
                  <span className="label">Zonas (arrastra para mover · esquina para cambiar el tamaño)</span>
                  <RegionPicker src={src.video_url} time={time} srcAspect={srcAspect}
                    boxes={[{ key: "main", label: spec.layout.mode === "split" ? "Gameplay" : spec.layout.face_track && spec.layout.mode === "crop" ? "Tamaño del encuadre" : "Zona visible", color: "#8b5cf6", region: spec.layout.main },
                      ...(spec.layout.mode === "split" && spec.layout.webcam ? [{ key: "webcam", label: "Cara / webcam", color: "#22d3ee", region: spec.layout.webcam }] : [])]}
                    onChange={(key, r, final) => apply(key === "webcam" ? "reframe_webcam" : "reframe_main", (s) => { if (key === "webcam") s.layout.webcam = r; else s.layout.main = r; return s; }, final)} />
                </div>
              )}
              {spec.layout.mode === "split" && spec.layout.webcam && (
                <Field label={`Altura de la cara arriba: ${Math.round(spec.layout.split_ratio * 100)} %`}>
                  <input type="range" min={0.2} max={0.6} step={0.01} value={spec.layout.split_ratio} className="w-full accent-[var(--color-accent)]"
                    onChange={(e) => apply("split_ratio", (s) => { s.layout.split_ratio = +e.target.value; return s; }, false)}
                    onPointerUp={() => apply("split_ratio", (s) => s)} />
                </Field>
              )}
              {spec.layout.mode !== "fit_black" && (
                <details className="rounded-lg border border-line p-2.5">
                  <summary className="cursor-pointer text-xs text-muted">Ajuste fino con números</summary>
                  <div className="mt-3 space-y-4">
                    <RegionEditor label={spec.layout.mode === "split" ? "Zona principal (gameplay)" : "Zona visible"} region={spec.layout.main}
                      onChange={(r, final) => apply("reframe_main", (s) => { s.layout.main = r; return s; }, final)} />
                    {spec.layout.mode === "split" && spec.layout.webcam && (
                      <RegionEditor label="Zona de la webcam" region={spec.layout.webcam} onChange={(r, final) => apply("reframe_webcam", (s) => { s.layout.webcam = r; return s; }, final)} />
                    )}
                  </div>
                </details>
              )}
              <Field label="Calidad de exportación"><Select value={spec.quality} onChange={(v) => apply("quality", (s) => { s.quality = v as EditSpec["quality"]; return s; })}
                options={[{ value: "1080p", label: "1080p" }, { value: "720p", label: "720p (más rápido)" }]} /></Field>
            </>)}

            {tab === "subs" && (<>
              <Toggle checked={spec.subtitles.enabled} onChange={(v) => apply("subtitles_toggle", (s) => { s.subtitles.enabled = v; return s; })} label="Subtítulos" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipografía"><Select value={st.font} onChange={(v) => setStyle("font", v)} options={["Inter", "Arial", "Montserrat", "Impact", "Verdana", "DejaVu Sans"].map((f) => ({ value: f, label: f }))} /></Field>
                <Field label={`Tamaño ${st.size}`}><input type="range" min={24} max={140} value={st.size} className="w-full accent-[var(--color-accent)]" onChange={(e) => setStyle("size", +e.target.value, false)} onPointerUp={() => setStyle("size", st.size)} /></Field>
                <Field label="Color"><input type="color" className="h-9 w-full rounded-lg border border-line bg-panel-2" value={st.color} onChange={(e) => setStyle("color", e.target.value.toUpperCase())} /></Field>
                <Field label="Resaltado"><input type="color" className="h-9 w-full rounded-lg border border-line bg-panel-2" value={st.highlight_color} onChange={(e) => setStyle("highlight_color", e.target.value.toUpperCase())} /></Field>
                <Field label="Contorno"><input type="color" className="h-9 w-full rounded-lg border border-line bg-panel-2" value={st.outline_color} onChange={(e) => setStyle("outline_color", e.target.value.toUpperCase())} /></Field>
                <Field label={`Grosor ${st.outline}`}><input type="range" min={0} max={12} value={st.outline} className="w-full accent-[var(--color-accent)]" onChange={(e) => setStyle("outline", +e.target.value, false)} onPointerUp={() => setStyle("outline", st.outline)} /></Field>
                <Field label={`Sombra ${st.shadow}`}><input type="range" min={0} max={10} value={st.shadow} className="w-full accent-[var(--color-accent)]" onChange={(e) => setStyle("shadow", +e.target.value, false)} onPointerUp={() => setStyle("shadow", st.shadow)} /></Field>
                <Field label="Posición"><Select value={st.position} onChange={(v) => setStyle("position", v)} options={[{ value: "bottom", label: "Abajo" }, { value: "middle", label: "Centro" }, { value: "top", label: "Arriba" }]} /></Field>
                <Field label="Animación"><Select value={st.animation} onChange={(v) => setStyle("animation", v)} options={[{ value: "karaoke", label: "Resaltar palabra" }, { value: "pop", label: "Pop" }, { value: "none", label: "Ninguna" }]} /></Field>
                <Field label="Palabras por línea"><input className="input" type="number" min={1} max={12} value={st.words_per_line} onChange={(e) => setStyle("words_per_line", Math.max(1, Math.min(12, +e.target.value)))} /></Field>
              </div>
              {st.position !== "middle" && <Field label={`Margen vertical ${st.margin_v}`}><input type="range" min={0} max={900} value={st.margin_v} className="w-full accent-[var(--color-accent)]" onChange={(e) => setStyle("margin_v", +e.target.value, false)} onPointerUp={() => setStyle("margin_v", st.margin_v)} /></Field>}
              <div className="flex flex-wrap gap-3"><Toggle checked={st.bold} onChange={(v) => setStyle("bold", v)} label="Negrita" /><Toggle checked={st.uppercase} onChange={(v) => setStyle("uppercase", v)} label="Mayúsculas" /></div>
              <button className="btn-secondary w-full" onClick={() => apply("regenerate_cues", (s) => { s.subtitles.cues = cuesFromWords(state.data!.words, s.segments, s.subtitles.style.words_per_line); return s; })}>
                <RotateCcw className="h-4 w-4" />Regenerar desde la transcripción</button>
              <div className="space-y-2">
                <div className="label">Textos ({spec.subtitles.cues.length})</div>
                {spec.subtitles.cues.map((c, i) => (
                  <div key={i} className="rounded-lg border border-line bg-panel-2 p-2">
                    <div className="mb-1 flex items-center gap-1 text-[10px] text-faint">
                      <button className="hover:text-accent-soft" onClick={() => seek(c.start)}>{fmtTimecode(c.start)} → {fmtTimecode(c.end)}</button>
                      <button className="btn-icon ml-auto h-6 w-6" aria-label="Eliminar subtítulo" onClick={() => apply("delete_cue", (s) => { s.subtitles.cues.splice(i, 1); return s; })}><Trash2 className="h-3 w-3" /></button>
                    </div>
                    <textarea className="input h-auto min-h-9 resize-y py-1.5" rows={1} defaultValue={c.text} aria-label={`Subtítulo ${i + 1}`}
                      onBlur={(e) => e.target.value !== c.text && apply("edit_cue", (s) => {
                        const cue = s.subtitles.cues[i]; const words = e.target.value.trim().split(/\s+/);
                        cue.text = e.target.value.trim();
                        // Redistribuye las palabras editadas en el tiempo del subtítulo (mantiene el resaltado)
                        const d = (cue.end - cue.start) / Math.max(1, words.length);
                        cue.words = words.map((w, k) => ({ start: +(cue.start + k * d).toFixed(3), end: +(cue.start + (k + 1) * d).toFixed(3), text: w }));
                        return s; })} />
                  </div>
                ))}
                <button className="btn-ghost w-full text-xs" onClick={() => apply("add_cue", (s) => { s.subtitles.cues.push({ start: +time.toFixed(2), end: +(time + 2).toFixed(2), text: "Nuevo texto", words: [] }); s.subtitles.cues.sort((a, b) => a.start - b.start); return s; })}>
                  <Plus className="h-3.5 w-3.5" />Añadir subtítulo en el cabezal</button>
              </div>
            </>)}

            {tab === "fx" && (<>
              <Toggle checked={spec.zoom.enabled} onChange={(v) => apply("zoom_toggle", (s) => { s.zoom.enabled = v; return s; })} label="Zooms" />
              {spec.zoom.punch_ins.map((p, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-line bg-panel-2 p-3 text-xs">
                  <div className="flex items-center justify-between"><span>Zoom {i + 1} · {p.t.toFixed(1)} s</span>
                    <button className="btn-icon h-6 w-6" aria-label="Quitar zoom" onClick={() => apply("zoom_remove", (s) => { s.zoom.punch_ins.splice(i, 1); return s; })}><Trash2 className="h-3 w-3" /></button></div>
                  <Field label={`Escala ${p.scale.toFixed(2)}×`}><input type="range" min={1.02} max={1.5} step={0.01} value={p.scale} className="w-full accent-[var(--color-accent)]"
                    onChange={(e) => apply("zoom_scale", (s) => { s.zoom.punch_ins[i].scale = +e.target.value; return s; }, false)} onPointerUp={() => apply("zoom_scale", (s) => s)} /></Field>
                  <Field label={`Duración ${p.duration.toFixed(1)} s`}><input type="range" min={0.5} max={6} step={0.1} value={p.duration} className="w-full accent-[var(--color-accent)]"
                    onChange={(e) => apply("zoom_duration", (s) => { s.zoom.punch_ins[i].duration = +e.target.value; return s; }, false)} onPointerUp={() => apply("zoom_duration", (s) => s)} /></Field>
                </div>
              ))}
              <button className="btn-secondary w-full" onClick={() => apply("zoom_add", (s) => { s.zoom.enabled = true; s.zoom.punch_ins.push({ t: +outTime.toFixed(2), duration: 1.5, scale: 1.15 }); return s; })}>
                <Plus className="h-4 w-4" />Añadir zoom en el cabezal</button>
              <Field label={`Fundido de entrada ${spec.fades.video_in.toFixed(2)} s`}><input type="range" min={0} max={1.5} step={0.05} value={spec.fades.video_in} className="w-full accent-[var(--color-accent)]"
                onChange={(e) => apply("fade_in", (s) => { s.fades.video_in = +e.target.value; return s; }, false)} onPointerUp={() => apply("fade_in", (s) => s)} /></Field>
              <Field label={`Fundido de salida ${spec.fades.video_out.toFixed(2)} s`}><input type="range" min={0} max={1.5} step={0.05} value={spec.fades.video_out} className="w-full accent-[var(--color-accent)]"
                onChange={(e) => apply("fade_out", (s) => { s.fades.video_out = +e.target.value; return s; }, false)} onPointerUp={() => apply("fade_out", (s) => s)} /></Field>
              <p className="text-[11px] text-faint">Los efectos son moderados a propósito. La vista previa es aproximada; el MP4 exportado es el resultado exacto.</p>
            </>)}

            {tab === "audio" && (<>
              <Toggle checked={spec.audio.normalize} onChange={(v) => apply("audio_normalize", (s) => { s.audio.normalize = v; return s; })} label="Normalizar volumen (EBU R128)" />
              <Field label={`Sonoridad objetivo ${spec.audio.target_lufs} LUFS`}><input type="range" min={-24} max={-9} step={1} value={spec.audio.target_lufs} className="w-full accent-[var(--color-accent)]"
                onChange={(e) => apply("audio_lufs", (s) => { s.audio.target_lufs = +e.target.value; return s; }, false)} onPointerUp={() => apply("audio_lufs", (s) => s)} /></Field>
              <Toggle checked={spec.audio.limiter} onChange={(v) => apply("audio_limiter", (s) => { s.audio.limiter = v; return s; })} label="Control de picos (limitador)" />
              <Toggle checked={spec.audio.denoise} onChange={(v) => apply("audio_denoise", (s) => { s.audio.denoise = v; return s; })} label="Reducción de ruido" />
              <Field label={`Ganancia ${spec.audio.gain_db} dB`}><input type="range" min={-12} max={12} step={1} value={spec.audio.gain_db} className="w-full accent-[var(--color-accent)]"
                onChange={(e) => apply("audio_gain", (s) => { s.audio.gain_db = +e.target.value; return s; }, false)} onPointerUp={() => apply("audio_gain", (s) => s)} /></Field>
            </>)}

            {tab === "versions" && (
              <div className="space-y-2">
                {detail.data?.versions.slice().reverse().map((v) => (
                  <div key={v.id} className={cn("rounded-lg border p-3 text-xs", v.is_current ? "border-accent/50 bg-accent-bg" : "border-line bg-panel-2")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">Versión {v.version_no}</span>
                      <Badge tone={v.status === "ready" ? "ok" : v.status === "failed" ? "danger" : "info"}>{v.status === "ready" ? "Lista" : v.status === "rendering" ? "Renderizando" : v.status === "failed" ? "Error" : "Borrador"}</Badge>
                    </div>
                    <div className="mt-1 text-muted">{v.note} · {fmtDate(v.created_at)}{v.duration ? ` · ${v.duration.toFixed(1)} s` : ""}{v.av_sync_diff !== null ? ` · sync A/V ${Math.round(v.av_sync_diff * 1000)} ms` : ""}</div>
                    <div className="mt-2 flex gap-1.5">
                      {v.video_url && <a className="btn-ghost h-7 text-xs" href={`/api/clips/${id}/download?version=${v.version_no}`} download><Download className="h-3.5 w-3.5" />MP4</a>}
                      {!v.is_current && <button className="btn-ghost h-7 text-xs" onClick={() => activate.mutate(v.id)}>Restaurar esta versión</button>}
                    </div>
                  </div>
                ))}
                {detail.data?.candidate && (
                  <div className="rounded-lg border border-line p-3 text-xs text-muted"><div className="mb-1 font-medium text-fg">Por qué se eligió</div>{detail.data.candidate.explanation}</div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
