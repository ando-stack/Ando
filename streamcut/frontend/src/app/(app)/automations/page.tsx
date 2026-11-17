"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ModeBadge } from "@/components/Capabilities";
import { Badge, Card, CardHeader, Empty, Field, PageHeader, PlatformTag, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, get, patch } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Channel, Template } from "@/lib/types";

type AP = Record<string, any>;

function AutopilotForm({ value, onChange, templates }: { value: AP; onChange: (v: AP) => void; templates: Template[] }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const cats: string[] = value.categories ?? [];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label={`Sensibilidad ${Number(value.sensitivity ?? 1).toFixed(1)}`}><input type="range" min={0.5} max={2} step={0.1} value={value.sensitivity ?? 1} onChange={(e) => set("sensitivity", +e.target.value)} className="w-full accent-[var(--color-accent)]" /></Field>
        <Field label="Puntuación mínima"><input className="input" type="number" min={0} max={100} value={value.min_score ?? 55} onChange={(e) => set("min_score", +e.target.value)} /></Field>
        <Field label="Clips máximos por directo"><input className="input" type="number" min={1} max={200} value={value.max_clips_per_stream ?? 20} onChange={(e) => set("max_clips_per_stream", +e.target.value)} /></Field>
        <Field label="Duración"><Select value={value.duration_mode ?? "auto"} onChange={(v) => set("duration_mode", v)} options={[{ value: "auto", label: "Automática" }, ...["15", "30", "45", "60"].map((x) => ({ value: x, label: `${x} s` }))]} /></Field>
        <Field label="Formato"><Select value={value.format ?? "9:16"} onChange={(v) => set("format", v)} options={["9:16", "16:9", "1:1"].map((f) => ({ value: f, label: f }))} /></Field>
        <Field label={`Tiempo mínimo entre clips: ${value.clip_cooldown_s ?? 30} s`}>
          <input type="range" min={10} max={180} step={5} value={value.clip_cooldown_s ?? 30} onChange={(e) => set("clip_cooldown_s", +e.target.value)} className="w-full accent-[var(--color-accent)]" />
        </Field>
        <Field label={`Espera antes de crear el clip: ${value.clip_delay_s ?? 8} s`} hint="Tras la reacción del chat, para que el clip incluya el momento completo">
          <input type="range" min={0} max={20} step={1} value={value.clip_delay_s ?? 8} onChange={(e) => set("clip_delay_s", +e.target.value)} className="w-full accent-[var(--color-accent)]" />
        </Field>
        <Field label="Plantilla"><Select value={value.template_slug ?? "gaming-viral"} onChange={(v) => set("template_slug", v)} options={templates.map((t) => ({ value: t.slug, label: t.name }))} /></Field>
      </div>
      <div className="flex flex-wrap gap-5">
        <Toggle checked={value.subtitles ?? true} onChange={(v) => set("subtitles", v)} label="Subtítulos" />
        <Toggle checked={value.auto_edit ?? true} onChange={(v) => set("auto_edit", v)} label="Edición automática" />
        <Toggle checked={value.auto_save ?? true} onChange={(v) => set("auto_save", v)} label="Renderizar y guardar automáticamente" />
        <Toggle checked={value.create_platform_clips ?? true} onChange={(v) => set("create_platform_clips", v)} label="Crear clips oficiales (Twitch, si está autorizado)" />
      </div>
      <div>
        <div className="label mb-1.5">Categorías de momentos (vacío = todas)</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CATEGORY_LABELS).map(([k, l]) => {
            const on = cats.includes(k);
            return <button key={k} type="button" onClick={() => set("categories", on ? cats.filter((c) => c !== k) : [...cats, k])}
              className={on ? "chip border-accent/60 text-accent-soft" : "chip"}>{l}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

function ChannelAutopilot({ channel, templates }: { channel: Channel; templates: Template[] }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [ap, setAp] = useState<AP>(channel.autopilot ?? {});
  const save = useMutation({
    mutationFn: (body: AP) => patch<Channel>(`/channels/${channel.id}`, { autopilot: body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); toast("AUTO PILOT actualizado", "ok"); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-medium">{channel.display_name}</span><PlatformTag platform={channel.platform} /><ModeBadge mode={channel.capabilities?.mode} />
            {channel.status === "online" && <Badge tone="live" dot>En directo</Badge>}</div>
          <p className="mt-0.5 text-xs text-muted">{channel.capabilities?.mode === "VIEW_ONLY" ? "Sin fuente autorizada ni clips de plataforma: el piloto solo registrará la emisión y el chat." : "Al detectar la emisión se iniciará el análisis automáticamente."}</p>
        </div>
        <Toggle checked={!!ap.enabled} onChange={(v) => { const n = { ...ap, enabled: v }; setAp(n); save.mutate(n); }} label="AUTO PILOT" />
        <button className="btn-ghost h-8 text-xs" onClick={() => setOpen(!open)}>{open ? "Ocultar" : "Ajustes propios"}</button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <AutopilotForm value={ap} onChange={setAp} templates={templates} />
          <div className="flex justify-end"><button className="btn-primary" onClick={() => save.mutate(ap)}><Save className="h-4 w-4" />Guardar</button></div>
        </div>
      )}
    </Card>
  );
}

export default function AutomationsPage() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<{ data: Record<string, AP> }>("/settings") });
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => get<Channel[]>("/channels") });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => get<Template[]>("/templates") });
  const [ap, setAp] = useState<AP | null>(null);
  useEffect(() => { if (settings.data && !ap) setAp(settings.data.data.autopilot); }, [settings.data, ap]);
  const save = useMutation({
    mutationFn: () => patch("/settings", { autopilot: ap }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast("Valores por defecto guardados", "ok"); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Automatizaciones" description="AUTO PILOT: cuando un canal empieza a emitir, STREAMCUT registra el directo, determina sus capacidades, analiza si hay acceso válido y crea, edita y guarda los clips sin que tengas la página abierta (basta con que el backend, el monitor y los workers estén en marcha)." />
      <Card>
        <CardHeader title="Valores por defecto del AUTO PILOT" icon={<Bot className="h-4 w-4" />} subtitle="Cada canal puede sobrescribirlos" />
        <div className="space-y-4 p-4">
          {ap && templates.data ? <AutopilotForm value={ap} onChange={setAp} templates={templates.data} /> : <Spinner />}
          <div className="flex justify-end"><button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4" />Guardar</button></div>
        </div>
      </Card>
      <h2 className="text-sm font-semibold">Canales</h2>
      {channels.data?.length === 0 && <Empty title="Añade canales para automatizarlos" />}
      <div className="space-y-3">{templates.data && channels.data?.map((c) => <ChannelAutopilot key={c.id} channel={c} templates={templates.data!} />)}</div>
    </div>
  );
}
