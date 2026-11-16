"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileVideo, MessageSquare, Pause, RotateCcw, Scissors, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Badge, Card, CardHeader, Empty, Field, Modal, PageHeader, Progress, ScoreRing, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, api, del, get, post } from "@/lib/api";
import { CATEGORY_LABELS, cn, fmtBytes, fmtDate, fmtDuration, fmtTimecode, JOB_STATUS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Asset, Job } from "@/lib/types";

const ACCEPT = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];

interface UploadItem {
  key: string; file: File; id?: string; offset: number; status: "pending" | "uploading" | "paused" | "done" | "error" | "duplicate";
  error?: string; abort?: AbortController;
}

const resumeKey = (f: File) => `streamcut-upload:${f.name}:${f.size}:${f.lastModified}`;

function useUploader(autoAnalyze: boolean, meta: { streamer: string; game: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const update = (key: string, patch: Partial<UploadItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const run = useCallback(async (item: UploadItem) => {
    const { file, key } = item;
    const abort = new AbortController();
    update(key, { status: "uploading", abort, error: undefined });
    try {
      let id = item.id ?? (() => { try { return localStorage.getItem(resumeKey(file)) ?? undefined; } catch { return undefined; } })();
      let offset = 0;
      let chunk = 8 * 1024 * 1024; // < límite de cuerpo del proxy de Next (10 MB)
      if (id) {
        try { offset = (await get<{ offset: number }>(`/uploads/${id}`)).offset; } catch { id = undefined; }
      }
      if (!id) {
        const r = await post<{ id: string; chunk_size: number }>("/uploads", {
          filename: file.name, size: file.size, title: file.name.replace(/\.[^.]+$/, ""),
          streamer_name: meta.streamer || null, game: meta.game || null,
        });
        id = r.id;
        chunk = r.chunk_size;
        try { localStorage.setItem(resumeKey(file), id); } catch { /* sin almacenamiento */ }
      }
      update(key, { id, offset });
      let retries = 0;
      while (offset < file.size) {
        const body = file.slice(offset, Math.min(file.size, offset + chunk));
        try {
          const r = await api<{ offset: number }>(`/uploads/${id}?offset=${offset}`, {
            method: "PUT", body, signal: abort.signal, headers: { "Content-Type": "application/octet-stream" },
          });
          offset = r.offset;
          retries = 0;
          update(key, { offset });
        } catch (e) {
          if (abort.signal.aborted) { update(key, { status: "paused" }); return; }
          if (e instanceof ApiError && e.status === 409 && typeof (e.detail as any)?.offset === "number") {
            offset = (e.detail as any).offset; continue;
          }
          if (++retries > 5) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** retries)); // reintento con espera
        }
      }
      const done = await post<{ duplicate: boolean; asset: Asset }>(`/uploads/${id}/complete`, { auto_analyze: autoAnalyze });
      try { localStorage.removeItem(resumeKey(file)); } catch { /* */ }
      update(key, { status: done.duplicate ? "duplicate" : "done" });
      toast(done.duplicate ? `«${file.name}» ya estaba en la biblioteca` : `«${file.name}» subido. Procesando…`, done.duplicate ? "info" : "ok");
      qc.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) {
      update(key, { status: "error", error: e instanceof Error ? e.message : "Error de subida" });
    }
  }, [autoAnalyze, meta.streamer, meta.game, qc, toast]);

  const add = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ACCEPT.some((e) => f.name.toLowerCase().endsWith(e)));
    if (list.length < Array.from(files).length) toast("Algunos archivos no tienen un formato admitido (MP4, MOV, MKV, WEBM)", "error");
    const news = list.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, offset: 0, status: "pending" as const }));
    setItems((xs) => [...news, ...xs]);
    (async () => { for (const n of news) await run(n); })();
  };
  const pause = (it: UploadItem) => it.abort?.abort();
  const cancel = async (it: UploadItem) => {
    it.abort?.abort();
    if (it.id && it.status !== "done") { try { await del(`/uploads/${it.id}`); } catch { /* */ } }
    try { localStorage.removeItem(resumeKey(it.file)); } catch { /* */ }
    setItems((xs) => xs.filter((x) => x.key !== it.key));
  };
  return { items, add, run, pause, cancel };
}

function JobLine({ job, label }: { job: Job | null; label: string }) {
  const qc = useQueryClient();
  const cancel = useMutation({ mutationFn: () => post(`/jobs/${job!.kind}/${job!.id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }) });
  const retry = useMutation({ mutationFn: () => post(`/jobs/${job!.kind}/${job!.id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }) });
  if (!job) return null;
  const active = job.status === "running" || job.status === "queued";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{label}: <span className={cn(job.status === "failed" ? "text-danger" : "text-fg")}>{job.stage && active ? job.stage : JOB_STATUS[job.status]}</span></span>
        <span className="flex items-center gap-1">
          {active && <><span className="tabular-nums text-faint">{Math.round(job.progress * 100)}%</span>
            <button className="btn-icon h-6 w-6" title="Cancelar" aria-label="Cancelar" onClick={() => cancel.mutate()}><X className="h-3 w-3" /></button></>}
          {(job.status === "failed" || job.status === "cancelled") && (
            <button className="btn-ghost h-6 px-2 text-xs" onClick={() => retry.mutate()}><RotateCcw className="h-3 w-3" />Reintentar</button>)}
        </span>
      </div>
      {active && <Progress value={job.progress} />}
      {job.status === "failed" && job.error && <p className="line-clamp-2 text-[11px] text-danger">{job.error}</p>}
    </div>
  );
}

function AnalyzeDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [mode, setMode] = useState("auto");
  const [custom, setCustom] = useState(40);
  const [sens, setSens] = useState(1);
  const [maxClips, setMaxClips] = useState(8);
  const [minScore, setMinScore] = useState(45);
  const [force, setForce] = useState(false);
  const run = useMutation({
    mutationFn: () => post(`/assets/${asset.id}/analyze`, {
      duration_mode: mode, custom_duration: mode === "custom" ? custom : null, sensitivity: sens, max_clips: maxClips,
      min_score: minScore, force,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); toast("Análisis en cola", "ok"); onClose(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title={`Analizar «${asset.title}»`}>
      <div className="space-y-4">
        <Field label="Duración de los clips">
          <Select value={mode} onChange={setMode} options={[
            { value: "auto", label: "Automática (15-60 s, por frases completas)" }, { value: "15", label: "15 segundos" },
            { value: "30", label: "30 segundos" }, { value: "45", label: "45 segundos" }, { value: "60", label: "60 segundos" },
            { value: "custom", label: "Personalizada" }]} />
        </Field>
        {mode === "custom" && <Field label={`Duración personalizada: ${custom} s`}><input type="range" min={5} max={180} value={custom} onChange={(e) => setCustom(+e.target.value)} className="w-full accent-[var(--color-accent)]" /></Field>}
        <Field label={`Sensibilidad: ${sens.toFixed(1)}`} hint="Más alta detecta más momentos (y más falsos positivos)">
          <input type="range" min={0.5} max={2} step={0.1} value={sens} onChange={(e) => setSens(+e.target.value)} className="w-full accent-[var(--color-accent)]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Máximo de clips"><input className="input" type="number" min={0} max={100} value={maxClips} onChange={(e) => setMaxClips(+e.target.value)} /></Field>
          <Field label="Puntuación mínima"><input className="input" type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(+e.target.value)} /></Field>
        </div>
        <Toggle checked={force} onChange={setForce} label="Repetir transcripción y análisis de audio (no reutilizar)" />
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending && <Spinner />}Analizar</button></div>
      </div>
    </Modal>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const chatRef = useRef<HTMLInputElement>(null);
  const detail = useQuery({ queryKey: ["assets", asset.id], queryFn: () => get<Asset>(`/assets/${asset.id}`), enabled: open });
  const clipIt = useMutation({
    mutationFn: (cid: string) => post(`/candidates/${cid}/clip`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assets"] }); toast("Clip creado, renderizando…", "ok"); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const remove = useMutation({ mutationFn: () => del(`/assets/${asset.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }) });
  const uploadChat = async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await api<{ messages: number }>(`/assets/${asset.id}/chat`, { method: "POST", body: fd });
      toast(`Chat importado: ${r.messages} mensajes. Vuelve a analizar para usarlo.`, "ok");
      qc.invalidateQueries({ queryKey: ["assets"] });
    } catch (e) { toast(e instanceof Error ? e.message : "Error", "error"); }
  };
  const st = asset.status;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-3">
        <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-panel-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {asset.thumbnail_url ? <img src={asset.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <FileVideo className="m-auto mt-5 h-5 w-5 text-faint" />}
          {asset.duration && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{fmtDuration(asset.duration)}</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{asset.title}</span>
            <Badge tone={st === "ready" ? "ok" : st === "failed" ? "danger" : "info"} dot={st === "processing"}>{
              { ready: "Listo", failed: "Error", processing: "Procesando", uploaded: "En cola", uploading: "Subiendo" }[st] ?? st}</Badge>
            {asset.has_chat && <Badge tone="info"><MessageSquare className="h-3 w-3" />Chat</Badge>}
          </div>
          <div className="text-[11px] text-faint">{fmtBytes(asset.size_bytes)} · {asset.width ? `${asset.width}×${asset.height}` : "—"} · {asset.fps ? `${asset.fps} fps` : ""} · {fmtDate(asset.created_at)}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <JobLine job={asset.ingestion} label="Ingesta" />
            <JobLine job={asset.analysis} label="Análisis" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {asset.clips > 0 && <Link href={`/library?source_asset_id=${asset.id}`} className="btn-secondary h-8 text-xs">{asset.clips} clips</Link>}
          {st === "ready" && <button className="btn-secondary h-8 text-xs" onClick={() => setAnalyzing(true)}><Sparkles className="h-3.5 w-3.5" />Analizar</button>}
          <input ref={chatRef} type="file" accept=".json,.jsonl,.txt" hidden onChange={(e) => e.target.files?.[0] && uploadChat(e.target.files[0])} />
          <button className="btn-icon" title="Importar registro de chat (JSON)" aria-label="Importar chat" onClick={() => chatRef.current?.click()}><MessageSquare className="h-4 w-4" /></button>
          <button className="btn-icon hover:text-danger" title="Eliminar" aria-label="Eliminar" onClick={() => confirm("¿Mover el vídeo a la papelera?") && remove.mutate()}><Trash2 className="h-4 w-4" /></button>
          <button className="btn-icon" aria-expanded={open} aria-label="Ver candidatos" onClick={() => setOpen(!open)}><ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} /></button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line bg-panel-2/40 p-3">
          {detail.isLoading ? <Spinner /> : (detail.data?.candidates?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">Sin candidatos todavía.</p>
          ) : (
            <div className="space-y-2">
              {detail.data?.analysis?.result?.modalities && (
                <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                  {Object.entries(detail.data.analysis.result.modalities as Record<string, string>).map(([k, v]) => <span key={k} className="chip">{k}: {v}</span>)}
                </div>
              )}
              {detail.data?.candidates?.map((c) => (
                <div key={c.id} className={cn("flex items-start gap-3 rounded-lg border border-line bg-panel p-3", c.status === "duplicate" && "opacity-50")}>
                  <ScoreRing score={c.score} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{CATEGORY_LABELS[c.category] ?? c.category}</span>
                      <span className="font-mono text-xs text-muted">{fmtTimecode(c.start)} → {fmtTimecode(c.end)} ({Math.round(c.end - c.start)} s)</span>
                      <Badge>{c.status === "clipped" ? "Con clip" : c.status === "duplicate" ? "Duplicado" : c.status === "rejected" ? "Rechazado" : "Pendiente"}</Badge>
                      <span className="text-xs text-faint">confianza {Math.round(c.confidence * 100)} %</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{c.explanation}</p>
                    {c.transcript_text && <p className="mt-1 line-clamp-2 text-xs italic text-faint">“{c.transcript_text}”</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(c.scores).map(([k, v]) => <span key={k} className="chip">{k} {Math.round(v * 100)}</span>)}
                    </div>
                  </div>
                  {c.status === "pending" && <button className="btn-secondary h-8 text-xs" onClick={() => clipIt.mutate(c.id)}><Scissors className="h-3.5 w-3.5" />Crear clip</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {analyzing && <AnalyzeDialog asset={asset} onClose={() => setAnalyzing(false)} />}
    </Card>
  );
}

export default function ImportPage() {
  const [drag, setDrag] = useState(false);
  const [auto, setAuto] = useState(true);
  const [streamer, setStreamer] = useState("");
  const [game, setGame] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const up = useUploader(auto, { streamer, game });
  const assets = useQuery({
    queryKey: ["assets"], queryFn: () => get<Asset[]>("/assets"),
    refetchInterval: (q) => ((q.state.data ?? []).some((a) => a.status !== "ready" && a.status !== "failed" ||
      ["queued", "running"].includes(a.analysis?.status ?? "")) ? 4000 : false),
  });
  return (
    <div>
      <PageHeader title="Importar vídeo" description="Sube grabaciones propias o autorizadas. El original nunca se modifica: se crean un proxy, el audio y las miniaturas, y se analiza automáticamente." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); up.add(e.dataTransfer.files); }}
          onClick={() => input.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          className={cn("grid cursor-pointer place-items-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-14 text-center transition-colors",
            drag ? "border-accent bg-accent-bg" : "border-line hover:border-line-strong hover:bg-panel/50")}>
          <input ref={input} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => e.target.files && up.add(e.target.files)} />
          <div className="rounded-2xl bg-accent-bg p-4 text-accent-soft"><Upload className="h-7 w-7" /></div>
          <p className="mt-4 text-base font-medium">Arrastra tus vídeos aquí</p>
          <p className="mt-1 text-sm text-muted">o haz clic para elegirlos · MP4, MOV, MKV, WEBM · subida reanudable</p>
        </div>
        <Card className="space-y-4 p-4">
          <Toggle checked={auto} onChange={setAuto} label="Analizar y crear clips automáticamente" />
          <Field label="Streamer (opcional)"><input className="input" value={streamer} onChange={(e) => setStreamer(e.target.value)} /></Field>
          <Field label="Juego o categoría (opcional)"><input className="input" value={game} onChange={(e) => setGame(e.target.value)} /></Field>
          <p className="text-[11px] text-faint">Si cierras la página, al volver a soltar el mismo archivo la subida continúa donde se quedó.</p>
        </Card>
      </div>

      {up.items.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Subidas" />
          <div className="divide-y divide-line">
            {up.items.map((it) => (
              <div key={it.key} className="flex items-center gap-3 px-4 py-3">
                <FileVideo className="h-4 w-4 shrink-0 text-faint" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex justify-between gap-2 text-sm"><span className="truncate">{it.file.name}</span>
                    <span className="shrink-0 text-xs text-muted">{fmtBytes(it.offset)} / {fmtBytes(it.file.size)}</span></div>
                  <Progress value={it.offset / it.file.size} />
                  {it.status === "error" && <p className="text-xs text-danger">{it.error}</p>}
                  {it.status === "duplicate" && <p className="text-xs text-warn">Archivo duplicado: ya existe en la biblioteca.</p>}
                  {it.status === "done" && <p className="text-xs text-ok">Subido · procesando en segundo plano</p>}
                </div>
                {it.status === "uploading" && <button className="btn-icon" aria-label="Pausar" onClick={() => up.pause(it)}><Pause className="h-4 w-4" /></button>}
                {(it.status === "paused" || it.status === "error") && <button className="btn-icon" aria-label="Reanudar" onClick={() => up.run(it)}><RotateCcw className="h-4 w-4" /></button>}
                {it.status !== "done" && it.status !== "duplicate" && <button className="btn-icon" aria-label="Cancelar" onClick={() => up.cancel(it)}><X className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold">Vídeos importados</h2>
      {assets.isLoading ? <Spinner /> : (assets.data ?? []).length === 0 ? (
        <Empty icon={<FileVideo className="h-5 w-5" />} title="Aún no has importado vídeos" />
      ) : (
        <div className="space-y-3">{assets.data!.map((a) => <AssetRow key={a.id} asset={a} />)}</div>
      )}
    </div>
  );
}
