"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError, get, post } from "@/lib/api";
import { cn, JOB_STATUS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Clip, Job } from "@/lib/types";
import { Field, Modal, Progress, Select, Spinner } from "./ui";

export interface PublishTarget {
  platform: "youtube" | "tiktok" | "instagram"; label: string; configured: boolean; connected: boolean;
  account: string | null; ready: boolean; reason: string | null;
}

type Publication = Job & { platform: string; external_url: string | null; privacy: string };

const COLORS: Record<string, string> = {
  youtube: "border-[#ff0033]/40 bg-[#ff0033]/10", tiktok: "border-[#25f4ee]/40 bg-[#25f4ee]/10",
  instagram: "border-[#e1306c]/40 bg-[#e1306c]/10",
};

export function PublishDialog({ clip, open, onClose }: { clip: Clip; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const targets = useQuery({ queryKey: ["publish-targets"], queryFn: () => get<PublishTarget[]>("/oauth/publish-targets"), enabled: open });
  const pubs = useQuery({
    queryKey: ["publications", clip.id], queryFn: () => get<Publication[]>(`/clips/${clip.id}/publications`), enabled: open,
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => ["queued", "running"].includes(p.status)) ? 3000 : false),
  });
  const [sel, setSel] = useState<string[]>([]);
  const [title, setTitle] = useState(clip.title.slice(0, 100));
  const [desc, setDesc] = useState(clip.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" "));
  const [privacy, setPrivacy] = useState("public");
  const send = useMutation({
    mutationFn: () => post<Publication[]>(`/clips/${clip.id}/publish`, { platforms: sel, title, description: desc || null, privacy }),
    onSuccess: () => { toast("Publicación en marcha", "ok"); setSel([]); qc.invalidateQueries({ queryKey: ["publications", clip.id] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const rendered = !!clip.video_url && clip.version_status === "ready";
  const toggle = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  return (
    <Modal open={open} onClose={onClose} title={`Publicar «${clip.title}»`}>
      {!rendered ? (
        <p className="text-sm text-muted">
          {clip.platform_clip_url
            ? "Los clips oficiales de Twitch se guardan como enlace (sin MP4), así que no se pueden publicar desde aquí."
            : "El clip todavía no tiene un MP4 editado y renderizado. Espera a que termine de procesarse."}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="label">Dónde publicarlo</span>
            {targets.isLoading && <Spinner />}
            {targets.data?.map((t) => (
              <label key={t.platform} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5",
                sel.includes(t.platform) ? COLORS[t.platform] : "border-line bg-panel-2", !t.ready && "cursor-not-allowed opacity-60")}>
                <input type="checkbox" disabled={!t.ready} checked={sel.includes(t.platform)} onChange={() => toggle(t.platform)}
                  className="h-4 w-4 accent-[var(--color-accent)]" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs text-muted">{t.ready ? `Cuenta: ${t.account ?? "conectada"}` : t.reason}</div>
                </div>
              </label>
            ))}
            {targets.data?.some((t) => !t.ready) && (
              <Link href="/settings" className="text-xs text-accent-soft hover:underline">Conectar cuentas en Configuración →</Link>
            )}
          </div>
          <Field label={`Título (${title.length}/100)`}>
            <input className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Descripción y hashtags" hint="En YouTube se añade #Shorts automáticamente.">
            <textarea className="input h-auto min-h-20 py-2" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} />
          </Field>
          <Field label="Visibilidad" hint="Las apps de desarrollador sin auditar publican en privado en YouTube y TikTok aunque elijas «Público».">
            <Select value={privacy} onChange={setPrivacy} options={[{ value: "public", label: "Público" }, { value: "unlisted", label: "Oculto (solo YouTube)" },
              { value: "friends", label: "Amigos (solo TikTok)" }, { value: "private", label: "Privado" }]} />
          </Field>
          {clip.format !== "9:16" && <p className="text-xs text-warn">Este clip no es vertical (9:16). Para Shorts, TikTok y Reels conviene cambiar el formato en el editor.</p>}
          <button className="btn-primary w-full" disabled={!sel.length || !title.trim() || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <Spinner /> : <Send className="h-4 w-4" />}Publicar{sel.length ? ` en ${sel.length} red${sel.length > 1 ? "es" : ""}` : ""}
          </button>
        </div>
      )}
      {(pubs.data?.length ?? 0) > 0 && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <span className="label">Publicaciones</span>
          {pubs.data!.map((p) => (
            <div key={p.id} className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                {p.status === "succeeded" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : p.status === "failed" ? <XCircle className="h-4 w-4 text-danger" /> : <Loader2 className="h-4 w-4 animate-spin text-accent-soft" />}
                <span className="font-medium text-fg">{targets.data?.find((t) => t.platform === p.platform)?.label ?? p.platform}</span>
                <span className="text-muted">{p.stage && p.status === "running" ? p.stage : JOB_STATUS[p.status]}</span>
                {p.external_url && <a className="ml-auto inline-flex items-center gap-1 text-accent-soft hover:underline" href={p.external_url} target="_blank" rel="noreferrer noopener">Ver<ExternalLink className="h-3 w-3" /></a>}
              </div>
              {p.status === "running" && <Progress value={p.progress} className="mt-2" />}
              {p.error && <p className="mt-1 text-danger">{p.error}</p>}
              {p.status === "succeeded" && p.privacy && !["public", "PUBLIC_TO_EVERYONE"].includes(p.privacy) && (
                <p className="mt-1 text-warn">Publicado como {p.privacy}: la plataforma limita la visibilidad de apps sin auditar.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
