"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Plus, Radio, RefreshCw, Trash2, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CapabilityList, ModeBadge } from "@/components/Capabilities";
import { Badge, Card, CardHeader, Empty, Field, Modal, PageHeader, PlatformTag, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, del, get, patch, post, put } from "@/lib/api";
import { cn, fmtDate, fmtDuration, timeAgo } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Channel, StreamSessionT, Template } from "@/lib/types";

function statusBadge(c: Channel) {
  if (c.status === "online") return <Badge tone="live" dot>En directo</Badge>;
  if (c.status === "offline") return <Badge>Offline</Badge>;
  if (c.status === "error") return <Badge tone="danger">Error</Badge>;
  return <Badge tone="warn">Desconocido</Badge>;
}

function AddChannel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const router = useRouter();
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: () => post<Channel>("/channels/resolve", { url }),
    onSuccess: async (c) => {
      await patch(`/channels/${c.id}`, { is_tracked: true });
      qc.invalidateQueries({ queryKey: ["channels"] });
      toast(c.created ? `Canal ${c.display_name} añadido` : `${c.display_name} ya estaba añadido`, "ok");
      onClose();
      setUrl("");
      router.push(`/channels?c=${c.id}`);
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Añadir canal">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Enlace o identificador" hint="twitch.tv/nombre, youtube.com/@canal, youtube.com/channel/UC… o un nombre de Twitch">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus required />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={add.isPending}>{add.isPending && <Spinner />}Añadir y seguir</button>
        </div>
      </form>
    </Modal>
  );
}

function SourceConfig({ channel }: { channel: Channel }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [mode, setMode] = useState<"listen" | "pull">(channel.source?.mode ?? "listen");
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [key, setKey] = useState<{ server: string; stream_key: string } | null>(null);
  const save = useMutation({
    mutationFn: () => put<Channel>(`/channels/${channel.id}/source`, { mode, url: mode === "pull" ? url : null, rights_confirmed: rights }),
    onSuccess: (c) => {
      qc.setQueryData(["channel", channel.id], c);
      qc.invalidateQueries({ queryKey: ["channels"] });
      if (c.stream_key) setKey({ server: c.source?.ingest_url ?? "", stream_key: c.stream_key });
      toast("Fuente autorizada guardada", "ok");
    },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => del<Channel>(`/channels/${channel.id}/source`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); setKey(null); toast("Fuente eliminada", "info"); },
  });
  const reveal = useMutation({
    mutationFn: () => get<{ server: string; stream_key: string }>(`/channels/${channel.id}/source/key`),
    onSuccess: setKey,
  });
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast("Copiado", "ok"));

  return (
    <Card>
      <CardHeader title="Fuente audiovisual autorizada" subtitle="Necesaria para el análisis completo y los clips MP4 propios" />
      <div className="space-y-4 p-4 text-sm">
        <p className="text-xs leading-relaxed text-muted">
          STREAMCUT no extrae vídeo del reproductor de Twitch o YouTube. Para analizar audio y vídeo, envía tu propia señal:
          añade en OBS una salida RTMP adicional hacia este equipo (modo servidor local) o indica una URL RTMP/SRT/HLS que tengas derecho a usar.
        </p>
        {channel.source && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
            <Badge tone={channel.source.status === "active" ? "ok" : "danger"}>{channel.source.mode === "listen" ? "Servidor RTMP local" : "URL remota"}</Badge>
            {channel.source.listen_port && <span className="text-xs text-muted">Puerto {channel.source.listen_port}</span>}
            {channel.source.last_error && <span className="text-xs text-danger">{channel.source.last_error}</span>}
            <div className="ml-auto flex gap-1">
              {channel.source.mode === "listen" && <button className="btn-ghost h-7 text-xs" onClick={() => reveal.mutate()}>Ver clave</button>}
              <button className="btn-ghost h-7 text-xs text-danger" onClick={() => remove.mutate()}>Quitar</button>
            </div>
          </div>
        )}
        {key && (
          <div className="space-y-2 rounded-lg border border-accent/30 bg-accent-bg p-3 text-xs">
            <div className="font-medium text-fg">Configura en OBS (Ajustes → Emisión → Personalizado, o plugin multi-RTMP):</div>
            {[["Servidor", key.server], ["Clave de retransmisión", key.stream_key]].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-muted">{k}</span>
                <code className="flex-1 truncate rounded bg-panel-3 px-2 py-1 font-mono">{v}</code>
                <button className="btn-icon h-7 w-7" onClick={() => copy(v)} aria-label={`Copiar ${k}`}><Copy className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <p className="text-faint">Sustituye &lt;IP-de-este-equipo&gt; por la IP local del ordenador donde corre STREAMCUT.</p>
          </div>
        )}
        <div className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs">
          {(["listen", "pull"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn("flex-1 rounded-md px-3 py-1.5", mode === m ? "bg-panel-3 text-fg" : "text-muted")}>
              {m === "listen" ? "Recibir desde mi OBS (RTMP local)" : "Leer una URL autorizada"}
            </button>
          ))}
        </div>
        {mode === "pull" && (
          <Field label="URL de la señal" hint="rtmp://, rtmps://, srt:// o https://…/playlist.m3u8 — se bloquean redes privadas salvo que lo permitas en la configuración del servidor">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="srt://mi-servidor:9000?streamid=…" />
          </Field>
        )}
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
          Confirmo que esta señal es mía o que tengo autorización expresa para grabarla y analizarla.
        </label>
        <button className="btn-primary" disabled={!rights || save.isPending || (mode === "pull" && !url)} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />}Guardar fuente
        </button>
      </div>
    </Card>
  );
}

function ChannelDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useApp((s) => s.toast);
  const ch = useQuery({ queryKey: ["channel", id], queryFn: () => get<Channel>(`/channels/${id}`) });
  const sessions = useQuery({ queryKey: ["sessions", id], queryFn: () => get<StreamSessionT[]>(`/channels/${id}/sessions`) });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => get<Template[]>("/templates") });
  const upd = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<Channel>(`/channels/${id}`, body),
    onSuccess: (c) => { qc.setQueryData(["channel", id], c); qc.invalidateQueries({ queryKey: ["channels"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const refresh = useMutation({ mutationFn: () => post<Channel>(`/channels/${id}/refresh`), onSuccess: (c) => qc.setQueryData(["channel", id], c) });
  const remove = useMutation({
    mutationFn: () => del(`/channels/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); router.push("/channels"); toast("Canal eliminado (sus clips se conservan)", "info"); },
  });
  const c = ch.data;
  if (!c) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {c.avatar_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            : <div className="grid h-12 w-12 place-items-center rounded-full bg-panel-3 font-semibold uppercase text-muted">{c.display_name.slice(0, 2)}</div>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{c.display_name}</h2><PlatformTag platform={c.platform} />{statusBadge(c)}<ModeBadge mode={c.capabilities?.mode} /></div>
            <div className="mt-1 text-xs text-muted">ID {c.external_id} · añadido {fmtDate(c.created_at, false)} · comprobado {timeAgo(c.last_checked_at)}</div>
          </div>
          <div className="flex gap-2">
            <Link className="btn-primary" href={`/?c=${c.id}`}><Radio className="h-4 w-4" />Abrir monitor</Link>
            <button className="btn-secondary" onClick={() => refresh.mutate()}><RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} /></button>
            <a className="btn-secondary" href={c.url} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-4 w-4" /></a>
            <button className="btn-danger" onClick={() => confirm("¿Eliminar el canal? Los clips se conservarán.") && remove.mutate()}><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
        {c.last_error && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{c.last_error}</p>}
        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <Toggle checked={c.is_tracked} onChange={(v) => upd.mutate({ is_tracked: v })} label="Seguimiento activo" />
          <Field label="Prioridad de procesamiento">
            <Select value={String(c.priority)} onChange={(v) => upd.mutate({ priority: Number(v) })}
              options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1 (máxima)" : String(i + 1) }))} />
          </Field>
          <Field label="Plantilla predeterminada">
            <Select value={c.default_template_id ?? ""} onChange={(v) => v && upd.mutate({ default_template_id: v })}
              options={[{ value: "", label: "La del AUTO PILOT" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
          </Field>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Capacidades y permisos" subtitle="Qué funciona realmente con este canal" />
          <div className="p-4"><CapabilityList caps={c.capabilities} />
            {(c.capabilities?.permission_issues.length ?? 0) > 0 && (
              <Link href="/settings" className="mt-4 inline-block text-xs text-accent-soft hover:underline">Conectar cuentas y claves de API →</Link>)}
          </div>
        </Card>
        <SourceConfig channel={c} />
      </div>
      <Card>
        <CardHeader title="Historial de emisiones" subtitle={`${sessions.data?.length ?? 0} emisiones registradas`} />
        <div className="divide-y divide-line">
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              {s.status === "live" ? <Badge tone="live" dot>En directo</Badge> : <Badge>Finalizada</Badge>}
              <span className="min-w-0 flex-1 truncate">{s.title ?? "Sin título"}</span>
              <span className="text-xs text-muted">{fmtDate(s.started_at)}</span>
              <span className="text-xs text-muted">{s.ended_at ? fmtDuration((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000) : "—"}</span>
              <ModeBadge mode={s.capability_mode} />
              <Link className="text-xs text-accent-soft hover:underline" href={`/library?channel_id=${c.id}`}>{s.clips ?? 0} clips</Link>
            </div>
          ))}
          {sessions.data?.length === 0 && <p className="px-4 py-6 text-sm text-muted">Todavía no se ha detectado ninguna emisión.</p>}
        </div>
      </Card>
    </div>
  );
}

function ChannelsPage() {
  const params = useSearchParams();
  const selected = params.get("c");
  const [adding, setAdding] = useState(false);
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => get<Channel[]>("/channels"), refetchInterval: 60_000 });
  return (
    <div>
      <PageHeader title="Canales" description="Canales seguidos, su estado real, sus permisos y su historial de emisiones."
        actions={<button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Añadir canal</button>} />
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2">
          {channels.isLoading && <Spinner />}
          {channels.data?.length === 0 && <Empty icon={<Tv className="h-5 w-5" />} title="Sin canales">Añade un canal de Twitch o YouTube para empezar.</Empty>}
          {channels.data?.map((c) => (
            <Link key={c.id} href={`/channels?c=${c.id}`}
              className={cn("card flex items-center gap-3 p-3 transition-colors hover:border-line-strong", selected === c.id && "border-accent/60 bg-accent-bg")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{c.display_name}</span><PlatformTag platform={c.platform} /></div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">{statusBadge(c)}{c.is_tracked && <Badge tone="accent">Seguido</Badge>}{c.autopilot?.enabled ? <Badge tone="ok">AUTO PILOT</Badge> : null}</div>
              </div>
              <span className="text-xs text-faint">{c.clips_count} clips</span>
            </Link>
          ))}
        </div>
        <div>{selected ? <ChannelDetail id={selected} /> : (
          <Empty title="Selecciona un canal">Elige un canal de la lista para ver sus capacidades, configurar una fuente autorizada o revisar su historial.</Empty>
        )}</div>
      </div>
      <AddChannel open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

export default function Page() {
  return <Suspense><ChannelsPage /></Suspense>;
}
