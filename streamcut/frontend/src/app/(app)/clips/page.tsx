"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clapperboard, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipCard } from "@/components/ClipCard";
import { Empty, PageHeader, Select, Spinner } from "@/components/ui";
import { ApiError, get, patch, post, qs } from "@/lib/api";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/format";
import type { Clip } from "@/lib/types";

const TABS = [
  { key: "pending", label: "Por revisar", status: "pending,detected" },
  { key: "processing", label: "Procesando", status: "processing,editing" },
  { key: "approved", label: "Aprobados", status: "approved,exported,published" },
  { key: "rejected", label: "Rechazados", status: "rejected" },
  { key: "all", label: "Todos", status: "" },
];

function ReviewCard({ clip, selected, onSelect }: { clip: Clip; selected: boolean; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: (status: string) => patch(`/clips/${clip.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clips"] }),
  });
  return (
    <div className="space-y-2">
      <ClipCard clip={clip} selectable selected={selected} onSelect={onSelect} />
      {["pending", "detected"].includes(clip.status) && (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary h-8 text-xs" onClick={() => setStatus.mutate("approved")}><Check className="h-3.5 w-3.5 text-ok" />Aprobar</button>
          <button className="btn-secondary h-8 text-xs" onClick={() => setStatus.mutate("rejected")}><X className="h-3.5 w-3.5 text-danger" />Rechazar</button>
        </div>
      )}
    </div>
  );
}

export default function ClipsPage() {
  const [tab, setTab] = useState("pending");
  const [channel, setChannel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();
  const toast = useApp((s) => s.toast);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = useMutation({
    mutationFn: () => post<{ accepted: unknown[]; rejected: { title?: string; reason: string }[] }>("/ai-editor/jobs", { clip_ids: [...selected] }),
    onSuccess: (r) => {
      if (r.accepted.length) toast(`${r.accepted.length} clip(s) enviados al Editor IA`, "ok");
      r.rejected.forEach((x) => toast(`${x.title ?? "Clip"}: ${x.reason}`, "error"));
      setSelected(new Set());
      if (r.accepted.length) router.push("/ai-editor");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const status = TABS.find((t) => t.key === tab)!.status;
  const facets = useQuery({ queryKey: ["clips", "facets"], queryFn: () => get<{ channels: { id: string; name: string }[] }>("/clips/facets") });
  const clips = useQuery({
    queryKey: ["clips", "review", tab, channel],
    queryFn: () => get<{ total: number; items: Clip[] }>(`/clips${qs({ status, channel_id: channel, sort: tab === "pending" ? "score" : "recent", limit: 60 })}`),
    refetchInterval: tab === "processing" ? 5000 : false,
  });
  return (
    <div>
      <PageHeader title="Clips" description="Revisa los clips generados por la IA: apruébalos, recházalos o publícalos. Marca uno o varios para enviarlos al Editor IA. La puntuación es una estimación de interés, no una probabilidad de viralidad." />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("-mb-px border-b-2 px-3.5 py-2 text-sm", tab === t.key ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>{t.label}</button>
          ))}
        </div>
        <div className="mb-2 w-60">
          <Select ariaLabel="Streamer" value={channel} onChange={setChannel}
            options={[{ value: "", label: "Todos los streamers" }, ...(facets.data?.channels ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
      </div>
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-panel-2/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
          <span>{selected.size} seleccionado{selected.size > 1 ? "s" : ""}</span>
          <button className="btn-primary h-8" onClick={() => send.mutate()} disabled={send.isPending}>
            {send.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}Enviar al Editor IA
          </button>
          <button className="btn-ghost h-8" onClick={() => setSelected(new Set((clips.data?.items ?? []).map((c) => c.id)))}>Seleccionar todos</button>
          <button className="btn-ghost ml-auto h-8" onClick={() => setSelected(new Set())}>Limpiar</button>
        </div>
      )}
      {clips.isLoading ? <Spinner /> : clips.data?.items.length === 0 ? (
        <Empty icon={<Clapperboard className="h-5 w-5" />} title="No hay clips en esta vista">Importa un vídeo o monitoriza un directo con fuente autorizada para generar clips.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {clips.data?.items.map((c) => <ReviewCard key={c.id} clip={c} selected={selected.has(c.id)} onSelect={toggle} />)}
        </div>
      )}
    </div>
  );
}
