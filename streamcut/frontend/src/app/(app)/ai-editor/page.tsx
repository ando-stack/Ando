"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Captions, Clapperboard, Download, Film, Pencil, RotateCcw, Scissors, Send, Smile, Sparkles, Upload, Wand2, X, ZoomIn,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipPlayer } from "@/components/ClipCard";
import { PublishDialog } from "@/components/PublishDialog";
import { Badge, Card, CardHeader, Empty, Field, PageHeader, Progress, Select, Spinner, Toggle } from "@/components/ui";
import { get, patch, post } from "@/lib/api";
import { cn, fmtBytes, fmtDate, fmtDuration } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Clip, Job, Template } from "@/lib/types";
import { ACCEPT, useUploader } from "@/lib/useUploader";

type Options = {
  format: string; style: string; subtitles: "key" | "full" | "none"; emotes: "few" | "normal" | "none";
  cut_silences: boolean; zoom: boolean; hook_title: boolean; denoise: boolean;
};
interface Summary {
  duration: number; removed_seconds: number; cuts: number; captions: number; caption_mode: string; emotes: string[];
  zooms: number; layout: string; hook: string; format: string;
}
interface AiJob { job: Job & { result?: Summary }; render: Job | null; clip: Clip | null }

const EMOJI: Record<string, string> = {
  laugh: "😂", rofl: "🤣", shock: "😱", fire: "🔥", skull: "💀", flushed: "😳", cry: "😭", cool: "😎", hundred: "💯", eyes: "👀",
};
const LAYOUT: Record<string, string> = { split: "Webcam + juego", crop: "Cara centrada", fit_blur: "Fondo difuminado", fit_black: "Con bandas" };

function OptionsPanel({ value, onChange, templates }: { value: Options; onChange: (o: Options) => void; templates: Template[] }) {
  const set = <K extends keyof Options>(k: K, v: Options[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Formato">
          <Select value={value.format} onChange={(v) => set("format", v)} options={[{ value: "9:16", label: "Vertical 9:16" }, { value: "1:1", label: "Cuadrado 1:1" }, { value: "16:9", label: "Horizontal 16:9" }]} />
        </Field>
        <Field label="Estilo">
          <Select value={value.style} onChange={(v) => set("style", v)} options={templates.map((t) => ({ value: t.slug, label: t.name }))} />
        </Field>
        <Field label="Subtítulos">
          <Select value={value.subtitles} onChange={(v) => set("subtitles", v as Options["subtitles"])}
            options={[{ value: "key", label: "Frases clave" }, { value: "full", label: "Todo" }, { value: "none", label: "Ninguno" }]} />
        </Field>
        <Field label="Emotes">
          <Select value={value.emotes} onChange={(v) => set("emotes", v as Options["emotes"])}
            options={[{ value: "few", label: "Pocos (1-2)" }, { value: "normal", label: "Algunos más (hasta 4)" }, { value: "none", label: "Ninguno" }]} />
        </Field>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Toggle checked={value.cut_silences} onChange={(v) => set("cut_silences", v)} label="Cortar silencios muertos" />
        <Toggle checked={value.zoom} onChange={(v) => set("zoom", v)} label="Zoom en la reacción" />
        <Toggle checked={value.hook_title} onChange={(v) => set("hook_title", v)} label="Título gancho al inicio" />
        <Toggle checked={value.denoise} onChange={(v) => set("denoise", v)} label="Reducir ruido de fondo" />
      </div>
    </div>
  );
}

function JobCard({ item }: { item: AiJob }) {
  const qc = useQueryClient();
  const [playing, setPlaying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const { job, render, clip } = item;
  const s = job.status === "succeeded" && job.result && "format" in job.result ? (job.result as Summary) : null;
  const retry = useMutation({ mutationFn: () => post(`/ai-editor/jobs/${job.id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-editor"] }) });
  const editing = ["queued", "running"].includes(job.status);
  const rendering = !editing && job.status === "succeeded" && render && ["queued", "running"].includes(render.status);
  const ready = job.status === "succeeded" && render?.status === "succeeded" && clip?.video_url;
  const stage = editing ? (job.stage ?? "En cola") : rendering ? (render!.stage ?? "Renderizando") : null;
  const progress = editing ? job.progress * 0.5 : rendering ? 0.5 + render!.progress * 0.5 : 1;

  return (
    <Card className="overflow-hidden animate-fade-in">
      <div className="flex gap-4 p-3">
        <button className="relative w-28 shrink-0 overflow-hidden rounded-lg bg-panel-2" style={{ aspectRatio: "9 / 16" }}
          onClick={() => ready && setPlaying(true)} aria-label="Reproducir resultado" disabled={!ready}>
          {clip?.thumbnail_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={clip.thumbnail_url} alt="" className="h-full w-full object-cover" />
            : <Film className="m-auto h-5 w-5 text-faint" />}
          {!ready && <span className="absolute inset-0 grid place-items-center bg-black/50">{job.status === "failed" ? <X className="h-5 w-5 text-danger" /> : <Spinner className="h-5 w-5 text-white" />}</span>}
          {ready && clip?.duration && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{fmtDuration(clip.duration)}</span>}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{clip?.title ?? "Clip eliminado"}</span>
            {ready ? <Badge tone="ok">Listo</Badge> : job.status === "failed" || render?.status === "failed" ? <Badge tone="danger">Error</Badge>
              : rendering ? <Badge tone="info" dot>Renderizando</Badge> : <Badge tone="info" dot>Editando con IA</Badge>}
          </div>
          <div className="text-[11px] text-faint">{clip?.streamer_name && `${clip.streamer_name} · `}{fmtDate(job.created_at)}</div>
          {stage && <><div className="text-xs text-muted">{stage}</div><Progress value={progress} /></>}
          {job.status === "failed" && <p className="text-xs text-danger">{job.error}</p>}
          {render?.status === "failed" && <p className="text-xs text-danger">{render.error}</p>}
          {s && (
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {s.hook && <span className="chip max-w-full truncate" title="Título gancho"><Sparkles className="h-3 w-3" />{s.hook}</span>}
              <span className="chip"><Film className="h-3 w-3" />{LAYOUT[s.layout] ?? s.layout} · {s.format}</span>
              {s.removed_seconds > 0.5 && <span className="chip"><Scissors className="h-3 w-3" />−{s.removed_seconds.toFixed(1)} s de silencios ({s.cuts} cortes)</span>}
              {s.captions > 0 && <span className="chip"><Captions className="h-3 w-3" />{s.captions} subtítulos</span>}
              {(s.emotes ?? []).length > 0 && <span className="chip"><Smile className="h-3 w-3" />{s.emotes.map((e) => EMOJI[e] ?? e).join(" ")}</span>}
              {s.zooms > 0 && <span className="chip"><ZoomIn className="h-3 w-3" />{s.zooms} zoom</span>}
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1">
            {ready && clip && <>
              <button className="btn-secondary h-8 text-xs" onClick={() => setPlaying(true)}><Clapperboard className="h-3.5 w-3.5" />Ver</button>
              <a className="btn-secondary h-8 text-xs" href={clip.download_url ?? "#"} download><Download className="h-3.5 w-3.5" />Descargar</a>
              <button className="btn-primary h-8 text-xs" onClick={() => setPublishing(true)}><Send className="h-3.5 w-3.5" />Publicar</button>
              <Link className="btn-ghost h-8 text-xs" href={`/editor/${clip.id}`}><Pencil className="h-3.5 w-3.5" />Retocar a mano</Link>
            </>}
            {!editing && !rendering && clip && <button className="btn-ghost h-8 text-xs" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw className="h-3.5 w-3.5" />Editar de nuevo</button>}
          </div>
        </div>
      </div>
      {playing && clip && <ClipPlayer clip={clip} open={playing} onClose={() => setPlaying(false)} />}
      {publishing && clip && <PublishDialog clip={clip} open={publishing} onClose={() => setPublishing(false)} />}
    </Card>
  );
}

export default function AiEditorPage() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const opts = useQuery({ queryKey: ["ai-editor", "options"], queryFn: () => get<{ options: Options }>("/ai-editor/options") });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => get<Template[]>("/templates") });
  const [o, setO] = useState<Options | null>(null);
  useEffect(() => { if (opts.data && !o) setO(opts.data.options); }, [opts.data, o]);
  const save = useMutation({
    mutationFn: (v: Options) => patch("/settings", { ai_editor: v }),
    onSuccess: () => toast("Preferencias del Editor IA guardadas", "ok"),
  });
  const up = useUploader({ mode: "edit", autoAnalyze: false, options: o ?? undefined });
  const jobs = useQuery({
    queryKey: ["ai-editor", "jobs"], queryFn: () => get<AiJob[]>("/ai-editor/jobs"),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => ["queued", "running"].includes(j.job.status) ||
      (j.render && ["queued", "running"].includes(j.render.status))) || up.items.some((i) => i.status === "uploading") ? 3000 : 15000),
  });
  const doneUploads = up.items.filter((i) => i.status === "done").length;
  useEffect(() => { qc.invalidateQueries({ queryKey: ["ai-editor", "jobs"] }); }, [doneUploads, qc]);
  const busy = (jobs.data ?? []).filter((j) => ["queued", "running"].includes(j.job.status)).length;

  return (
    <div>
      <PageHeader title="Editor IA" description="Edición automática y profesional: encuadre vertical, cortes de silencios, subtítulos en las frases importantes, algún emote en las reacciones, zoom y título gancho. Envía clips desde la sección Clips o sube los tuyos aquí."
        actions={<Link className="btn-secondary" href="/clips"><Clapperboard className="h-4 w-4" />Elegir clips</Link>} />
      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Cómo editar" icon={<Wand2 className="h-4 w-4" />} subtitle="Se aplica a los clips que envíes o subas" />
            <div className="space-y-4 p-4">
              {o && templates.data ? <OptionsPanel value={o} onChange={setO} templates={templates.data} /> : <Spinner />}
              <button className="btn-secondary w-full" disabled={!o || save.isPending} onClick={() => o && save.mutate(o)}>Guardar como predeterminado</button>
            </div>
          </Card>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); up.add(e.dataTransfer.files); }}
            onClick={() => input.current?.click()} role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            className={cn("grid cursor-pointer place-items-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors",
              drag ? "border-accent bg-accent-bg" : "border-line hover:border-line-strong hover:bg-panel/50")}>
            <input ref={input} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => e.target.files && up.add(e.target.files)} />
            <div className="rounded-2xl bg-accent-bg p-3 text-accent-soft"><Upload className="h-6 w-6" /></div>
            <p className="mt-3 text-sm font-medium">Sube tus clips para editarlos</p>
            <p className="mt-1 text-xs text-muted">Arrastra uno o varios · MP4, MOV, MKV, WEBM</p>
          </div>
          {up.items.length > 0 && (
            <Card className="divide-y divide-line">
              {up.items.map((it) => (
                <div key={it.key} className="space-y-1.5 px-3 py-2.5 text-xs">
                  <div className="flex justify-between gap-2"><span className="truncate">{it.file.name}</span><span className="text-muted">{fmtBytes(it.offset)} / {fmtBytes(it.file.size)}</span></div>
                  <Progress value={it.offset / it.file.size} />
                  {it.status === "done" && <p className="text-ok">Subido · editando con IA</p>}
                  {it.status === "duplicate" && <p className="text-warn">Ese vídeo ya estaba en la biblioteca: búscalo en Clips y envíalo desde allí.</p>}
                  {it.status === "error" && <p className="text-danger">{it.error}</p>}
                </div>
              ))}
            </Card>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Ediciones {busy > 0 && <span className="ml-1 text-xs font-normal text-muted">{busy} en curso</span>}</h2>
          </div>
          {jobs.isLoading ? <Spinner /> : (jobs.data ?? []).length === 0 ? (
            <Empty icon={<Sparkles className="h-5 w-5" />} title="Todavía no has editado nada">
              Ve a <Link className="text-accent-soft underline" href="/clips">Clips</Link>, selecciona uno o varios y pulsa «Enviar al Editor IA», o sube tus clips aquí.
            </Empty>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">{jobs.data!.map((j) => <JobCard key={j.job.id} item={j} />)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
