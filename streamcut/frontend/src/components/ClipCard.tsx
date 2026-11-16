"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Heart, Loader2, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { del, patch, post } from "@/lib/api";
import { CATEGORY_LABELS, cn, fmtDate, fmtDuration, STATUS_LABELS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Clip } from "@/lib/types";
import { Badge, Modal, PlatformTag, ScoreRing } from "./ui";

const STATUS_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "danger" | "info"> = {
  detected: "neutral", pending: "accent", processing: "info", editing: "warn", approved: "ok", rejected: "danger",
  exported: "ok", published: "ok",
};

export function ClipStatus({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot={status === "processing"}>
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function ClipPlayer({ clip, open, onClose }: { clip: Clip; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={clip.title} wide>
      {clip.video_url ? (
        <video src={clip.video_url} controls autoPlay playsInline
          className={cn("mx-auto max-h-[72dvh] rounded-lg bg-black", clip.format === "9:16" ? "aspect-[9/16]" : clip.format === "1:1" ? "aspect-square" : "aspect-video w-full")} />
      ) : clip.platform_clip_url ? (
        <div className="space-y-3 text-sm text-muted">
          <p>Este es un clip oficial de la plataforma. Sin permiso de descarga, STREAMCUT conserva su enlace y metadatos.</p>
          <a className="btn-secondary" href={clip.platform_clip_url} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="h-4 w-4" />Abrir en la plataforma
          </a>
        </div>
      ) : (
        <p className="text-sm text-muted">Este clip todavía no tiene un MP4 renderizado.</p>
      )}
    </Modal>
  );
}

export function ClipCard({ clip, selectable, selected, onSelect, showRestore }: {
  clip: Clip; selectable?: boolean; selected?: boolean; onSelect?: (id: string) => void; showRestore?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [playing, setPlaying] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["clips"] }); qc.invalidateQueries({ queryKey: ["clip", clip.id] }); };
  const fav = useMutation({ mutationFn: () => patch(`/clips/${clip.id}`, { is_favorite: !clip.is_favorite }), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => del(`/clips/${clip.id}`),
    onSuccess: () => { refresh(); toast("Clip movido a la papelera", "info"); },
  });
  const restore = useMutation({ mutationFn: () => post(`/clips/${clip.id}/restore`), onSuccess: () => { refresh(); toast("Clip recuperado", "ok"); } });

  return (
    <div className={cn("group card overflow-hidden transition-colors hover:border-line-strong animate-fade-in", selected && "border-accent/70 ring-1 ring-accent/40")}>
      <div className="relative aspect-video cursor-pointer overflow-hidden bg-panel-2" onClick={() => setPlaying(true)}>
        {clip.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full place-items-center text-faint">{clip.status === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sin miniatura"}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur"><Play className="ml-0.5 h-5 w-5 text-white" /></span>
        </div>
        <div className="absolute bottom-2 left-2 flex gap-1.5">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">{fmtDuration(clip.duration)}</span>
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{clip.format}</span>
        </div>
        {selectable && (
          <label className="absolute left-2 top-2" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={!!selected} onChange={() => onSelect?.(clip.id)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label="Seleccionar clip" />
          </label>
        )}
        <div className="absolute right-2 top-2"><ScoreRing score={clip.score} size={34} /></div>
      </div>
      <div className="space-y-2.5 p-3">
        <div>
          <Link href={`/editor/${clip.id}`} className="line-clamp-2 text-sm font-medium leading-snug text-fg hover:text-accent-soft">{clip.title}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <PlatformTag platform={clip.platform} />
            {clip.streamer_name && <span className="truncate">{clip.streamer_name}</span>}
            {clip.category && <span className="chip">{CATEGORY_LABELS[clip.category] ?? clip.category}</span>}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
          <ClipStatus status={clip.status} />
          <span title="Hora del directo / creación">{fmtDate(clip.stream_time ?? clip.created_at)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-2">
          <div className="flex items-center">
            <button className="btn-icon" title="Reproducir" aria-label="Reproducir" onClick={() => setPlaying(true)}><Play className="h-4 w-4" /></button>
            {clip.source_asset_id && (
              <Link className="btn-icon" title="Editar" aria-label="Editar" href={`/editor/${clip.id}`}><Pencil className="h-4 w-4" /></Link>
            )}
            {clip.download_url ? (
              <a className="btn-icon" title="Descargar MP4" aria-label="Descargar" href={clip.download_url} download><Download className="h-4 w-4" /></a>
            ) : clip.platform_clip_url ? (
              <a className="btn-icon" title="Ver en la plataforma" aria-label="Ver en la plataforma" href={clip.platform_clip_url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" /></a>
            ) : null}
          </div>
          <div className="flex items-center">
            <button className={cn("btn-icon", clip.is_favorite && "text-danger hover:text-danger")} title="Favorito" aria-label="Favorito"
              aria-pressed={clip.is_favorite} onClick={() => fav.mutate()}>
              <Heart className={cn("h-4 w-4", clip.is_favorite && "fill-current")} />
            </button>
            {showRestore ? (
              <button className="btn-icon" title="Recuperar" aria-label="Recuperar" onClick={() => restore.mutate()}><RotateCcw className="h-4 w-4" /></button>
            ) : (
              <button className="btn-icon hover:text-danger" title="Eliminar" aria-label="Eliminar" onClick={() => remove.mutate()}><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
        </div>
      </div>
      {playing && <ClipPlayer clip={clip} open={playing} onClose={() => setPlaying(false)} />}
    </div>
  );
}
