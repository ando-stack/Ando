"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api, ApiError, del, get, post } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Asset } from "@/lib/types";

export const ACCEPT = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];

/** Subidas reanudables por trozos de 8 MB (se pueden pausar, reanudar y continuar tras cerrar la página). */
export interface UploadItem {
  key: string; file: File; id?: string; offset: number; status: "pending" | "uploading" | "paused" | "done" | "error" | "duplicate";
  error?: string; abort?: AbortController;
}

const resumeKey = (f: File) => `streamcut-upload:${f.name}:${f.size}:${f.lastModified}`;

export function useUploader(opts: { autoAnalyze?: boolean; streamer?: string; game?: string; mode?: "highlights" | "edit"; options?: Record<string, unknown> }) {
  const autoAnalyze = opts.autoAnalyze ?? true;
  const meta = { streamer: opts.streamer ?? "", game: opts.game ?? "" };
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
      const done = await post<{ duplicate: boolean; asset: Asset }>(`/uploads/${id}/complete`, { auto_analyze: autoAnalyze, mode: opts.mode ?? "highlights", options: opts.options ?? null });
      try { localStorage.removeItem(resumeKey(file)); } catch { /* */ }
      update(key, { status: done.duplicate ? "duplicate" : "done" });
      toast(done.duplicate ? `«${file.name}» ya estaba en la biblioteca` : `«${file.name}» subido. Procesando…`, done.duplicate ? "info" : "ok");
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["ai-editor"] });
    } catch (e) {
      update(key, { status: "error", error: e instanceof Error ? e.message : "Error de subida" });
    }
  }, [autoAnalyze, meta.streamer, meta.game, opts.mode, opts.options, qc, toast]);

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
