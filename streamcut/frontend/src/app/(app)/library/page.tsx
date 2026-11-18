"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, FolderPlus, Heart, Library, Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ClipCard } from "@/components/ClipCard";
import { Card, Empty, PageHeader, Select, Spinner } from "@/components/ui";
import { ApiError, del, get, post, qs } from "@/lib/api";
import { CATEGORY_LABELS, cn, STATUS_LABELS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Clip, Collection } from "@/lib/types";

interface Facets {
  streamers: string[]; games: string[]; categories: string[]; platforms: string[]; formats: string[]; tags: string[];
  channels: { id: string; name: string }[];
}

const KEYS = ["q", "channel_id", "platform", "game", "category", "status", "format", "favorite", "min_score", "max_duration",
  "date_from", "tag", "collection_id", "source_asset_id", "deleted", "sort"] as const;

function LibraryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const filters = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ""])) as Record<string, string>, [params]);
  const [q, setQ] = useState(filters.q);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCol, setNewCol] = useState("");
  const set = (k: string, v: string) => {
    const u = new URLSearchParams(params.toString());
    if (v) u.set(k, v); else u.delete(k);
    setPage(0);
    router.replace(`/library?${u.toString()}`);
  };
  useEffect(() => { const t = setTimeout(() => q !== filters.q && set("q", q), 350); return () => clearTimeout(t); });

  const facets = useQuery({ queryKey: ["clips", "facets"], queryFn: () => get<Facets>("/clips/facets") });
  const cols = useQuery({ queryKey: ["collections"], queryFn: () => get<Collection[]>("/collections") });
  const limit = 40;
  const clips = useQuery({
    queryKey: ["clips", "library", filters, page],
    queryFn: () => get<{ total: number; items: Clip[] }>(`/clips${qs({ ...filters, sort: filters.sort || "recent", limit, offset: page * limit })}`),
  });
  const createCol = useMutation({
    mutationFn: () => post<Collection>("/collections", { name: newCol }),
    onSuccess: () => { setNewCol(""); qc.invalidateQueries({ queryKey: ["collections"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const addToCol = useMutation({
    mutationFn: async (colId: string) => { for (const id of selected) await post(`/clips/${id}/collections/${colId}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collections"] }); qc.invalidateQueries({ queryKey: ["clips"] }); toast("Añadidos a la colección", "ok"); },
  });
  const sendAi = useMutation({
    mutationFn: () => post<{ accepted: unknown[]; rejected: { title?: string; reason: string }[] }>("/ai-editor/jobs", { clip_ids: [...selected] }),
    onSuccess: (r) => {
      if (r.accepted.length) toast(`${r.accepted.length} clip(s) enviados al Editor IA`, "ok");
      r.rejected.forEach((x) => toast(`${x.title ?? "Clip"}: ${x.reason}`, "error"));
      setSelected(new Set());
      if (r.accepted.length) router.push("/ai-editor");
    },
  });
  const bulkDelete = useMutation({
    mutationFn: async () => { for (const id of selected) await del(`/clips/${id}`); },
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["clips"] }); },
  });
  const downloadZip = async () => {
    const res = await fetch("/api/clips/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selected] }) });
    if (!res.ok) { toast("Ninguno de los clips seleccionados tiene MP4", "error"); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "streamcut-clips.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const opt = (all: string, xs: string[] | undefined, label: (x: string) => string = (x) => x) => [{ value: "", label: all }, ...(xs ?? []).map((x) => ({ value: x, label: label(x) }))];
  const total = clips.data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Biblioteca" description="Todos tus clips, persistentes y organizados. Busca también por lo que se dice dentro del clip."
        actions={<>
          <a className="btn-secondary" href="/api/clips/export-metadata?format=csv"><FileJson className="h-4 w-4" />CSV</a>
          <a className="btn-secondary" href="/api/clips/export-metadata?format=json"><FileJson className="h-4 w-4" />JSON</a>
        </>} />
      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="space-y-1 text-sm">
            {[{ k: "", label: "Todos los clips", icon: <Library className="h-4 w-4" /> },
              { k: "fav", label: "Favoritos", icon: <Heart className="h-4 w-4" /> },
              { k: "trash", label: "Papelera", icon: <Trash2 className="h-4 w-4" /> }].map((v) => {
              const active = v.k === "fav" ? filters.favorite === "true" : v.k === "trash" ? filters.deleted === "true" : !filters.favorite && !filters.deleted && !filters.collection_id;
              return (
                <button key={v.k} onClick={() => router.replace(v.k === "fav" ? "/library?favorite=true" : v.k === "trash" ? "/library?deleted=true" : "/library")}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2", active ? "bg-accent-bg text-fg" : "text-muted hover:bg-panel-2")}>{v.icon}{v.label}</button>
              );
            })}
          </div>
          <div>
            <div className="mb-1.5 px-1 text-[11px] uppercase tracking-wider text-faint">Colecciones</div>
            {cols.data?.map((c) => (
              <button key={c.id} onClick={() => router.replace(`/library?collection_id=${c.id}`)}
                className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm", filters.collection_id === c.id ? "bg-accent-bg text-fg" : "text-muted hover:bg-panel-2")}>
                <span className="truncate">{c.name}</span><span className="text-xs text-faint">{c.clips}</span>
              </button>
            ))}
            <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newCol.trim()) createCol.mutate(); }}>
              <input className="input h-8 text-xs" placeholder="Nueva colección" value={newCol} onChange={(e) => setNewCol(e.target.value)} />
              <button className="btn-icon" aria-label="Crear colección"><FolderPlus className="h-4 w-4" /></button>
            </form>
          </div>
          {(facets.data?.tags.length ?? 0) > 0 && (
            <div>
              <div className="mb-1.5 px-1 text-[11px] uppercase tracking-wider text-faint">Etiquetas</div>
              <div className="flex flex-wrap gap-1">
                {facets.data!.tags.map((t) => (
                  <button key={t} onClick={() => set("tag", filters.tag === t ? "" : t)} className={cn("chip", filters.tag === t && "border-accent/50 text-accent-soft")}>#{t}</button>
                ))}
              </div>
            </div>
          )}
        </aside>
        <div className="min-w-0">
          <Card className="mb-4 space-y-3 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input className="input h-10 pl-9" placeholder="Buscar por título, streamer, etiqueta o texto hablado…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Select ariaLabel="Canal" value={filters.channel_id} onChange={(v) => set("channel_id", v)} options={[{ value: "", label: "Todos los canales" }, ...(facets.data?.channels ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
              <Select ariaLabel="Plataforma" value={filters.platform} onChange={(v) => set("platform", v)} options={opt("Todas las plataformas", facets.data?.platforms, (x) => (x === "twitch" ? "Twitch" : "YouTube"))} />
              <Select ariaLabel="Juego" value={filters.game} onChange={(v) => set("game", v)} options={opt("Todos los juegos", facets.data?.games)} />
              <Select ariaLabel="Categoría" value={filters.category} onChange={(v) => set("category", v)} options={opt("Todas las categorías", facets.data?.categories, (x) => CATEGORY_LABELS[x] ?? x)} />
              <Select ariaLabel="Estado" value={filters.status} onChange={(v) => set("status", v)} options={[{ value: "", label: "Todos los estados" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
              <Select ariaLabel="Formato" value={filters.format} onChange={(v) => set("format", v)} options={[{ value: "", label: "Todos los formatos" }, { value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" }, { value: "1:1", label: "1:1" }]} />
              <Select ariaLabel="Puntuación" value={filters.min_score} onChange={(v) => set("min_score", v)} options={[{ value: "", label: "Cualquier puntuación" }, ...[50, 60, 70, 80, 90].map((n) => ({ value: String(n), label: `≥ ${n}` }))]} />
              <Select ariaLabel="Orden" value={filters.sort || "recent"} onChange={(v) => set("sort", v)} options={[{ value: "recent", label: "Recientes" }, { value: "score", label: "Mejor puntuados" }, { value: "duration", label: "Más largos" }, { value: "oldest", label: "Antiguos" }, { value: "title", label: "Título" }]} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Duración máx.</span>
              <Select ariaLabel="Duración" className="h-8 w-44" value={filters.max_duration} onChange={(v) => set("max_duration", v)} options={[{ value: "", label: "Cualquier duración" }, ...[15, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} s` }))]} />
              <span>Desde</span>
              <input type="date" className="input h-8 w-40" value={filters.date_from.slice(0, 10)} onChange={(e) => set("date_from", e.target.value)} aria-label="Desde la fecha" />
              <span className="ml-auto">{total} clips</span>
            </div>
          </Card>
          {selected.size > 0 && (
            <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-panel-2/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
              <span>{selected.size} seleccionados</span>
              <button className="btn-primary h-8" onClick={() => sendAi.mutate()} disabled={sendAi.isPending}><Sparkles className="h-4 w-4" />Enviar al Editor IA</button>
              <button className="btn-secondary h-8" onClick={downloadZip}><Download className="h-4 w-4" />Descargar ZIP</button>
              <Select ariaLabel="Añadir a colección" className="h-8 w-48" value="" onChange={(v) => v && addToCol.mutate(v)} options={[{ value: "", label: "Añadir a colección…" }, ...(cols.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
              <button className="btn-danger h-8" onClick={() => bulkDelete.mutate()}><Trash2 className="h-4 w-4" />Eliminar</button>
              <button className="btn-ghost ml-auto h-8" onClick={() => setSelected(new Set())}>Limpiar</button>
            </div>
          )}
          {clips.isLoading ? <Spinner /> : clips.data?.items.length === 0 ? (
            <Empty icon={<Library className="h-5 w-5" />} title="No hay clips con estos filtros" />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {clips.data?.items.map((c) => <ClipCard key={c.id} clip={c} selectable selected={selected.has(c.id)} onSelect={toggle} showRestore={filters.deleted === "true"} />)}
            </div>
          )}
          {total > limit && (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm">
              <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
              <span className="text-muted">{page + 1} / {Math.ceil(total / limit)}</span>
              <button className="btn-secondary" disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><LibraryPage /></Suspense>;
}
