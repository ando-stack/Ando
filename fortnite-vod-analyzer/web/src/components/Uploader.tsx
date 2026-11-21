"use client";

import { CheckCircle2, FileArchive, Film, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError, uploadFile } from "@/lib/api";
import { fmtBytes, fmtTime } from "@/lib/format";
import type { Media } from "@/lib/types";
import { Button, ErrorBox, Progress, cx } from "./ui";

const VIDEO_EXT = [".mp4", ".mov", ".mkv", ".webm"];

interface LocalInfo { duration?: number; width?: number; height?: number }

export function Uploader({ matchId, kind, maxMb, onDone }: { matchId: string; kind: "video" | "replay"; maxMb?: number; onDone: (m: Media) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [local, setLocal] = useState<LocalInfo | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number; speed: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "verifying" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const exts = kind === "video" ? VIDEO_EXT : [".replay"];

  function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!exts.includes(ext)) {
      setError(kind === "video" ? "Formato no permitido. Usa MP4, MOV, MKV o WEBM." : "Selecciona un archivo .replay de Fortnite (Documentos/FortniteGame/Saved/Demos).");
      return;
    }
    if (maxMb && f.size > maxMb * 1024 * 1024) {
      setError(`El archivo supera el máximo de ${maxMb} MB.`);
      return;
    }
    setFile(f);
    setLocal(null);
    if (kind === "video") {
      const url = URL.createObjectURL(f);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { setLocal({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); URL.revokeObjectURL(url); };
      v.onerror = () => URL.revokeObjectURL(url);
      v.src = url;
    }
  }

  async function start() {
    if (!file) return;
    setPhase("uploading");
    setError(null);
    abort.current = new AbortController();
    try {
      const r = await uploadFile(matchId, file, kind, (sent, total, speed) => {
        setProgress({ sent, total, speed });
        if (sent >= total) setPhase("verifying");
      }, abort.current.signal);
      setMedia(r.media);
      setPhase("done");
      onDone(r.media);
    } catch (e: any) {
      setPhase("idle");
      setProgress(null);
      setError(e instanceof ApiError ? e.message : "Error de subida");
    }
  }

  const pct = progress ? (100 * progress.sent) / progress.total : 0;
  const eta = progress && progress.speed > 0 ? (progress.total - progress.sent) / progress.speed : null;
  const Icon = kind === "video" ? Film : FileArchive;

  return (
    <div className="space-y-3">
      {!file && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          role="button" tabIndex={0}
          className={cx("focus-ring flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
            drag ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:border-brand/60")}
        >
          <UploadCloud className={cx("mb-3 size-8", drag ? "text-brand" : "text-ink-3")} />
          <div className="font-medium">Arrastra aquí {kind === "video" ? "el vídeo" : "la replay"} o haz clic para seleccionar</div>
          <div className="mt-1 text-sm text-ink-3">{kind === "video" ? "MP4, MOV, MKV o WEBM" : "Archivo .replay"}{maxMb ? ` · máx. ${maxMb >= 1024 ? `${(maxMb / 1024).toFixed(0)} GB` : `${maxMb} MB`}` : ""}</div>
          <input ref={input} type="file" accept={exts.join(",")} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      )}

      {file && (
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-3 text-ink-2"><Icon className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{file.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                <span>Tamaño <b className="tabular font-medium text-ink-2">{fmtBytes(file.size)}</b></span>
                {kind === "video" && <span>Duración <b className="tabular font-medium text-ink-2">{media?.duration_s ? fmtTime(media.duration_s) : local?.duration ? fmtTime(local.duration) : "se lee en el servidor"}</b></span>}
                {kind === "video" && <span>Resolución <b className="tabular font-medium text-ink-2">{media?.width ? `${media.width}×${media.height}` : local?.width ? `${local.width}×${local.height}` : "—"}</b></span>}
                {media?.fps ? <span>FPS <b className="tabular font-medium text-ink-2">{media.fps}</b></span> : null}
                {media?.video_codec && <span>Códec <b className="font-medium text-ink-2">{media.video_codec}{media.audio_codec ? ` / ${media.audio_codec}` : " / sin audio"}</b></span>}
                {media?.kind === "replay" && <span>Versión <b className="font-medium text-ink-2">{String(media.meta?.branch || "—")}</b></span>}
              </div>
            </div>
            {phase === "idle" && <button onClick={() => { setFile(null); setError(null); }} className="text-ink-3 hover:text-ink" aria-label="Quitar archivo"><X className="size-4" /></button>}
            {phase === "done" && <CheckCircle2 className="size-5 text-ok" />}
          </div>
          {(phase === "uploading" || phase === "verifying") && (
            <div className="mt-4">
              <Progress value={pct} />
              <div className="tabular mt-2 flex justify-between text-xs text-ink-3">
                <span>{phase === "verifying" ? "Verificando archivo en el servidor (integridad, formato, metadatos)…" : `${fmtBytes(progress?.sent)} de ${fmtBytes(progress?.total)} · ${Math.round(pct)}%`}</span>
                {phase === "uploading" && <span>{progress?.speed ? `${fmtBytes(progress.speed)}/s` : ""}{eta != null ? ` · ${fmtTime(eta)} restante` : ""}</span>}
              </div>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            {phase === "idle" && <Button variant="primary" onClick={start}>Subir archivo</Button>}
            {phase === "uploading" && <Button variant="ghost" onClick={() => abort.current?.abort()}>Cancelar subida</Button>}
          </div>
        </div>
      )}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
