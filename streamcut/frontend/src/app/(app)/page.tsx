"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowRight, Clapperboard, Cpu, ExternalLink, Eye, Gauge, HardDrive, Link2, ListChecks,
  MessageSquare, Play, Radio, RefreshCw, Scissors, Sparkles, Square, Timer, Users, Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CapabilityList, MODE_INFO, ModeBadge } from "@/components/Capabilities";
import { ClipCard } from "@/components/ClipCard";
import { Badge, Card, CardHeader, Empty, PlatformTag, Spinner } from "@/components/ui";
import { api, ApiError, get, post, qs } from "@/lib/api";
import { cn, fmtDuration, fmtNumber, since, timeAgo } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Channel, Clip, DetectedEvent, Platform } from "@/lib/types";

interface LiveStatus {
  monitor_alive: boolean;
  resources: { cpu_percent?: number; mem_percent?: number; disk_free_gb?: number; gpu?: string | null };
  pending_jobs: { ingestion: number; analysis: number; render: number };
  session: null | {
    id: string; monitoring: boolean; mode: string; started_at: string; analyzed_seconds: number; clips: number;
    rendered: number; candidates: number; avg_latency_s: number | null; runner: Record<string, any> | null;
  };
}

const EVENT_STYLE: Record<string, { icon: React.ReactNode; tone: string }> = {
  loud_reaction: { icon: <Zap className="h-3.5 w-3.5" />, tone: "text-warn" },
  scream: { icon: <Zap className="h-3.5 w-3.5" />, tone: "text-warn" },
  laughter: { icon: <Sparkles className="h-3.5 w-3.5" />, tone: "text-accent-soft" },
  chat_spike: { icon: <MessageSquare className="h-3.5 w-3.5" />, tone: "text-info" },
  moment: { icon: <Activity className="h-3.5 w-3.5" />, tone: "text-accent-soft" },
  candidate: { icon: <ListChecks className="h-3.5 w-3.5" />, tone: "text-accent-soft" },
  candidate_rejected: { icon: <ListChecks className="h-3.5 w-3.5" />, tone: "text-faint" },
  platform_clip: { icon: <Scissors className="h-3.5 w-3.5" />, tone: "text-ok" },
  stream_online: { icon: <Radio className="h-3.5 w-3.5" />, tone: "text-live" },
  stream_offline: { icon: <Radio className="h-3.5 w-3.5" />, tone: "text-faint" },
};

function ConnectBar({ onConnected }: { onConnected: (c: Channel) => void }) {
  const platform = useApp((s) => s.platform);
  const setPlatform = useApp((s) => s.setPlatform);
  const toast = useApp((s) => s.toast);
  const [url, setUrl] = useState("");
  const connect = useMutation({
    mutationFn: () => post<Channel>("/channels/resolve", { url, platform }),
    onSuccess: (c) => { onConnected(c); setUrl(""); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const placeholder = platform === "twitch" ? "https://www.twitch.tv/nombre_del_streamer" : "https://www.youtube.com/@canal";
  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) connect.mutate(); }}>
      <div className="flex shrink-0 rounded-lg border border-line bg-panel-2 p-0.5" role="radiogroup" aria-label="Plataforma">
        {(["twitch", "youtube"] as Platform[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={platform === p} onClick={() => setPlatform(p)}
            className={cn("rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
              platform === p ? (p === "twitch" ? "bg-[#9146ff]/20 text-[#c4a6ff]" : "bg-[#ff0033]/15 text-[#ff8a9a]") : "text-muted hover:text-fg")}>
            {p === "twitch" ? "Twitch" : "YouTube"}
          </button>
        ))}
      </div>
      <div className="relative flex-1">
        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input className="input h-10 pl-9" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder}
          aria-label="Enlace del canal" spellCheck={false} />
      </div>
      <button className="btn-primary h-10 px-5" disabled={connect.isPending || !url.trim()}>
        {connect.isPending ? <Spinner /> : <ArrowRight className="h-4 w-4" />}Conectar
      </button>
    </form>
  );
}

function StatusPill({ channel }: { channel: Channel }) {
  if (channel.status === "online") return <Badge tone="live" dot>EN DIRECTO</Badge>;
  if (channel.status === "offline") return <Badge>Offline</Badge>;
  if (channel.status === "error") return <Badge tone="danger">Error de API</Badge>;
  return <Badge tone="warn">Estado desconocido</Badge>;
}

function Player({ channel }: { channel: Channel }) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.hostname), []);
  const embed = useQuery({
    queryKey: ["embed", channel.id, host, channel.live_video_id],
    queryFn: () => get<{ player: string | null; chat: string | null; original: string }>(`/live/${channel.id}/embed${qs({ parent: host })}`),
    enabled: !!host,
  });
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-black">
      {embed.data?.player ? (
        <iframe key={embed.data.player} src={embed.data.player} title={`Reproductor oficial de ${channel.display_name}`}
          className="absolute inset-0 h-full w-full" allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          {embed.isLoading ? <Spinner /> : "No hay reproductor disponible para este canal (configura la API de YouTube para localizar el directo)."}
        </div>
      )}
    </div>
  );
}

function ChannelInfo({ channel, onRefresh, refreshing }: { channel: Channel; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {channel.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.avatar_url} alt="" className="h-11 w-11 rounded-full border border-line object-cover" />
        ) : (
          <div className="grid h-11 w-11 place-items-center rounded-full bg-panel-3 text-sm font-semibold uppercase text-muted">{channel.display_name.slice(0, 2)}</div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{channel.display_name}</h2>
            <PlatformTag platform={channel.platform} />
            <StatusPill channel={channel} />
          </div>
          <p className="truncate text-sm text-muted">{channel.title ?? (channel.status === "unknown" ? "Sin credenciales de API: el estado no puede consultarse" : "Sin título")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
        {channel.category && <span className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" />{channel.category}</span>}
        {channel.viewer_count !== null && <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{fmtNumber(channel.viewer_count)}</span>}
        {channel.live_started_at && <span className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" />{since(channel.live_started_at)}</span>}
        <span className="flex items-center gap-1.5" title="Última comprobación"><Eye className="h-3.5 w-3.5" />{timeAgo(channel.last_checked_at)}</span>
        <button className="btn-ghost h-7 px-2" onClick={onRefresh} disabled={refreshing} aria-label="Actualizar estado">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
        <a className="btn-secondary h-7 px-2.5 text-xs" href={channel.url} target="_blank" rel="noreferrer noopener">
          <ExternalLink className="h-3.5 w-3.5" />Canal original
        </a>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2.5" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">{icon}{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function AIPanel({ channel }: { channel: Channel }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const stats = useApp((s) => s.liveStats[channel.id]);
  const status = useQuery({
    queryKey: ["live-status", channel.id],
    queryFn: () => get<LiveStatus>(`/live/status${qs({ channel_id: channel.id })}`),
    refetchInterval: 5000,
  });
  const events = useQuery({
    queryKey: ["live-events", channel.id],
    queryFn: () => get<DetectedEvent[]>(`/live/events${qs({ channel_id: channel.id, limit: 40 })}`),
    refetchInterval: 15000,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["channels"] }); qc.invalidateQueries({ queryKey: ["live-status", channel.id] }); };
  const start = useMutation({
    mutationFn: () => post<Channel>(`/live/${channel.id}/start`),
    onSuccess: (c) => { qc.setQueryData(["channel", channel.id], c); refresh(); toast("Monitorización iniciada", "ok"); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const stop = useMutation({
    mutationFn: () => post<Channel>(`/live/${channel.id}/stop`),
    onSuccess: (c) => { qc.setQueryData(["channel", channel.id], c); refresh(); },
  });
  const clipNow = useMutation({
    mutationFn: () => post<{ url: string }>(`/live/${channel.id}/platform-clip`),
    onSuccess: () => toast("Clip oficial creado en Twitch", "ok"),
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const s = status.data;
  const monitoring = !!channel.session?.monitoring;
  const mode = channel.capabilities?.mode;
  const runner = stats ?? (s?.session?.runner as typeof stats | undefined);
  const mediaAccess = mode === "FULL_ANALYSIS";
  const last = events.data?.find((e) => !["monitoring_start", "monitoring_stop"].includes(e.type));
  const res = runner?.resources ?? s?.resources ?? {};
  const pending = s ? s.pending_jobs.ingestion + s.pending_jobs.analysis + s.pending_jobs.render : 0;
  const platformClipsOk = channel.capabilities?.features.find((f) => f.key === "platform_clips")?.status === "available";

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader icon={<Sparkles className="h-4 w-4" />} title="AI LIVE DETECTION"
        subtitle={mode ? MODE_INFO[mode].text : undefined} action={<ModeBadge mode={mode} />} />
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={cn("h-2 w-2 rounded-full", monitoring ? "bg-ok animate-pulse-live" : "bg-faint")} />
              {monitoring ? "Monitorizando" : "Monitorización detenida"}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {!s?.monitor_alive ? "El servicio de monitorización no está activo" :
                runner?.note ?? (monitoring ? `Activa desde ${since(s?.session?.started_at)}` : "Pulsa iniciar para analizar el directo")}
            </p>
          </div>
          {monitoring ? (
            <button className="btn-secondary" onClick={() => stop.mutate()} disabled={stop.isPending}><Square className="h-3.5 w-3.5" />Detener</button>
          ) : (
            <button className="btn-primary" onClick={() => start.mutate()} disabled={start.isPending || channel.status === "offline"}
              title={channel.status === "offline" ? "El canal no está en directo" : undefined}>
              {start.isPending ? <Spinner /> : <Play className="h-3.5 w-3.5" />}INICIAR MONITORIZACIÓN
            </button>
          )}
        </div>

        <div className={cn("rounded-lg border px-3 py-2.5 text-xs", mediaAccess ? "border-ok/30 bg-ok/5 text-ok" : "border-warn/30 bg-warn/5 text-warn")}>
          <div className="flex items-center gap-2 font-medium">
            {mediaAccess ? <Activity className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {mediaAccess ? (runner?.media_access ? "Recibiendo señal audiovisual autorizada" : "Fuente autorizada configurada (esperando señal)") :
              "Sin acceso al audio/vídeo: no se analiza la emisión"}
          </div>
          {!mediaAccess && (
            <p className="mt-1 text-muted">
              El reproductor embebido no permite analizar el vídeo. Para clips propios, añade una <Link className="text-accent-soft underline" href={`/channels?c=${channel.id}`}>fuente autorizada</Link> (tu OBS por RTMP, SRT o HLS).
              {channel.platform === "twitch" && " La señal del chat sí se analiza."}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric icon={<ListChecks className="h-3 w-3" />} label="Candidatos" value={s?.session?.candidates ?? 0} />
          <Metric icon={<Clapperboard className="h-3 w-3" />} label="Clips" value={`${s?.session?.rendered ?? 0}/${s?.session?.clips ?? 0}`} hint="Renderizados / creados" />
          <Metric icon={<Timer className="h-3 w-3" />} label="Pendientes" value={pending} hint="Trabajos en cola o en curso" />
          <Metric icon={<MessageSquare className="h-3 w-3" />} label="Chat" value={fmtNumber(runner?.chat_messages ?? 0)} hint="Mensajes analizados" />
          <Metric icon={<Activity className="h-3 w-3" />} label="Analizado" value={fmtDuration(runner?.analyzed_seconds ?? s?.session?.analyzed_seconds ?? 0)} />
          <Metric icon={<Zap className="h-3 w-3" />} label="Latencia" value={s?.session?.avg_latency_s ? `${Math.round(s.session.avg_latency_s)} s` : "—"} hint="Latencia media real momento → clip" />
        </div>

        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wider text-faint">Último evento detectado</div>
          {last ? (
            <div className="mt-1.5">
              <div className={cn("flex items-center gap-2 text-sm font-medium", EVENT_STYLE[last.type]?.tone)}>{EVENT_STYLE[last.type]?.icon}{last.label}</div>
              <div className="mt-1 flex gap-3 text-xs text-muted">
                <span>{last.type}</span>
                {last.confidence !== null && <span>Confianza {Math.round(last.confidence * 100)} %</span>}
                <span>{timeAgo(last.created_at)}</span>
              </div>
            </div>
          ) : <p className="mt-1.5 text-sm text-muted">Todavía no hay eventos reales para este canal.</p>}
        </div>

        {channel.platform === "twitch" && monitoring && (
          <button className="btn-secondary w-full" disabled={!platformClipsOk || clipNow.isPending} onClick={() => clipNow.mutate()}
            title={platformClipsOk ? "Crea un clip oficial de los últimos segundos" : "Conecta tu cuenta de Twitch con permiso clips:edit"}>
            {clipNow.isPending ? <Spinner /> : <Scissors className="h-4 w-4" />}Clip oficial ahora
          </button>
        )}

        <div className="grid grid-cols-3 gap-2 text-[11px] text-muted">
          <div className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />CPU {res.cpu_percent ?? "—"}%</div>
          <div className="flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" />RAM {res.mem_percent ?? "—"}%</div>
          <div className="flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" />{res.disk_free_gb ?? "—"} GB libres</div>
          <div className="col-span-3 text-faint">Aceleración: {res.gpu ? `GPU (${res.gpu})` : "CPU"}</div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="px-4 pt-3 text-[11px] uppercase tracking-wider text-faint">Actividad</div>
        <ul className="max-h-72 space-y-0.5 overflow-auto px-2 py-2">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-panel-2 animate-fade-in">
              <span className={cn("mt-0.5", EVENT_STYLE[e.type]?.tone ?? "text-faint")}>{EVENT_STYLE[e.type]?.icon ?? <Activity className="h-3.5 w-3.5" />}</span>
              <span className="flex-1 text-fg/90">{e.label}</span>
              <span className="shrink-0 text-faint">{new Date(e.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </li>
          ))}
          {events.data?.length === 0 && <li className="px-2 py-3 text-xs text-muted">Sin actividad todavía.</li>}
        </ul>
      </div>
    </Card>
  );
}

function ChannelClips({ channelId }: { channelId: string }) {
  const clips = useQuery({
    queryKey: ["clips", "channel", channelId],
    queryFn: () => get<{ total: number; items: Clip[] }>(`/clips${qs({ channel_id: channelId, sort: "recent", limit: 24 })}`),
  });
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Clips generados <span className="ml-1 text-muted">{clips.data?.total ?? ""}</span></h3>
        <Link href={`/library?channel_id=${channelId}`} className="text-xs text-accent-soft hover:underline">Ver en la biblioteca</Link>
      </div>
      {clips.data && clips.data.items.length === 0 ? (
        <Empty icon={<Clapperboard className="h-5 w-5" />} title="Aún no hay clips de este canal">
          Aparecerán aquí automáticamente en cuanto se detecte y procese un momento destacado.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {clips.data?.items.map((c) => <ClipCard key={c.id} clip={c} />)}
        </div>
      )}
    </section>
  );
}

function ChannelsStrip({ channels, activeId, onOpen }: { channels: Channel[]; activeId: string | null; onOpen: (c: Channel) => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const stats = useApp((s) => s.liveStats);
  const toggle = useMutation({
    mutationFn: ({ c, on }: { c: Channel; on: boolean }) => post<Channel>(`/live/${c.id}/${on ? "start" : "stop"}`),
    onSuccess: (c) => { qc.setQueryData(["channel", c.id], c); qc.invalidateQueries({ queryKey: ["channels"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const startAll = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const c of channels.filter((x) => x.status !== "offline" && !x.session?.monitoring)) {
        try { await post(`/live/${c.id}/start`); n++; } catch { /* canal sin directo */ }
      }
      return n;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["channels"] }); toast(n ? `Monitorizando ${n} canal(es) más` : "No hay más canales en directo para monitorizar", n ? "ok" : "info"); },
  });
  if (!channels.length) return null;
  const monitoring = channels.filter((c) => c.session?.monitoring).length;
  return (
    <Card className="mb-5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-sm font-semibold">Canales <span className="ml-1 text-xs font-normal text-muted">{monitoring} monitorizando a la vez</span></div>
        <button className="btn-secondary h-8 text-xs" onClick={() => startAll.mutate()} disabled={startAll.isPending}>
          {startAll.isPending ? <Spinner /> : <Play className="h-3.5 w-3.5" />}Monitorizar todos los que estén en directo
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {channels.map((c) => {
          const on = !!c.session?.monitoring;
          const st = stats[c.id];
          return (
            <div key={c.id} className={cn("flex min-w-56 shrink-0 items-center gap-2.5 rounded-lg border px-2.5 py-2",
              c.id === activeId ? "border-accent/60 bg-accent-bg" : "border-line bg-panel-2")}>
              <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => onOpen(c)}>
                {c.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  : <div className="grid h-8 w-8 place-items-center rounded-full bg-panel-3 text-[10px] font-semibold uppercase text-muted">{c.display_name.slice(0, 2)}</div>}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.status === "online" ? "bg-live animate-pulse-live" : "bg-faint")} />
                    <span className="truncate font-medium">{c.display_name}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {on ? `Monitorizando · ${c.clips_count} clips${st ? ` · ${st.chat_messages} msg` : ""}` : c.status === "online" ? "En directo" : c.status === "offline" ? "Offline" : "Estado desconocido"}
                  </div>
                </div>
              </button>
              <button className={cn("btn-icon", on ? "text-ok hover:text-danger" : "hover:text-ok")} title={on ? "Detener monitorización" : "Iniciar monitorización"}
                aria-label={on ? `Detener ${c.display_name}` : `Monitorizar ${c.display_name}`} disabled={toggle.isPending}
                onClick={() => toggle.mutate({ c, on: !on })}>
                {on ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LiveMonitor() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const channelId = params.get("c");
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => get<Channel[]>("/channels"), refetchInterval: 15_000 });
  const channel = useQuery({
    queryKey: ["channel", channelId],
    queryFn: () => get<Channel>(`/channels/${channelId}`),
    enabled: !!channelId,
    refetchInterval: 30_000,
  });
  const refresh = useMutation({
    mutationFn: () => post<Channel>(`/channels/${channelId}/refresh`),
    onSuccess: (c) => qc.setQueryData(["channel", channelId], c),
  });
  useEffect(() => {
    // Las actualizaciones SSE de canales invalidan "channels": refrescamos también el canal activo
    if (channelId && channels.dataUpdatedAt) qc.invalidateQueries({ queryKey: ["channel", channelId] });
  }, [channels.dataUpdatedAt, channelId, qc]);

  const select = (c: Channel) => {
    qc.setQueryData(["channel", c.id], c);
    qc.invalidateQueries({ queryKey: ["channels"] });
    router.push(`/?c=${c.id}`);
  };
  const ch = channel.data;
  const procState = useMemo(() => {
    if (!ch) return null;
    if (ch.session?.monitoring) return { tone: "ok" as const, text: "Procesando" };
    return { tone: "neutral" as const, text: "En espera" };
  }, [ch]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitor de directos</h1>
          <p className="mt-1 text-sm text-muted">Introduce el enlace de un canal, míralo en directo y deja que la IA saque los mejores momentos.</p>
        </div>
        {ch && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">Conexión</span><StatusPill channel={ch} />
            <span className="ml-2 text-muted">Procesamiento</span><Badge tone={procState?.tone} dot>{procState?.text}</Badge>
          </div>
        )}
      </div>
      <Card className="mb-5 p-3"><ConnectBar onConnected={select} /></Card>
      <ChannelsStrip channels={channels.data ?? []} activeId={channelId} onOpen={select} />

      {!channelId ? (
        <div className="space-y-4">
          {channels.data && channels.data.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-muted">Tus canales</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {channels.data.map((c) => (
                  <button key={c.id} onClick={() => select(c)} className="card flex items-center gap-3 p-3 text-left transition-colors hover:border-line-strong">
                    {c.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : <div className="grid h-10 w-10 place-items-center rounded-full bg-panel-3 text-xs font-semibold uppercase text-muted">{c.display_name.slice(0, 2)}</div>}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{c.display_name}</span><PlatformTag platform={c.platform} /></div>
                      <div className="mt-1 flex items-center gap-2"><StatusPill channel={c} /><ModeBadge mode={c.capabilities?.mode} /></div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Empty icon={<Radio className="h-5 w-5" />} title="Conecta tu primer canal">
              Pega arriba el enlace de un canal de Twitch o YouTube. STREAMCUT AI identificará el canal, comprobará si está emitiendo y te mostrará qué puede hacer con él.
            </Empty>
          )}
        </div>
      ) : channel.isLoading ? (
        <div className="grid h-64 place-items-center"><Spinner className="h-6 w-6" /></div>
      ) : ch ? (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0">
              <Player channel={ch} />
              <ChannelInfo channel={ch} onRefresh={() => refresh.mutate()} refreshing={refresh.isPending} />
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Capacidades activas de este canal</h3>
                  <Link href={`/channels?c=${ch.id}`} className="text-xs text-accent-soft hover:underline">Gestionar permisos</Link>
                </div>
                <div className="grid gap-x-8 gap-y-2 md:grid-cols-2"><CapabilityList caps={ch.capabilities} /></div>
              </Card>
            </div>
            <AIPanel channel={ch} />
          </div>
          <ChannelClips channelId={ch.id} />
        </>
      ) : (
        <Empty title="Canal no encontrado" action={<Link className="btn-secondary" href="/">Volver</Link>} />
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense><LiveMonitor /></Suspense>;
}
