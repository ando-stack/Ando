"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Link2, Plug, Save, Send, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Badge, Card, CardHeader, Field, PageHeader, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { fmtBytes, fmtDate } from "@/lib/format";
import { useApp } from "@/lib/store";

type SettingsData = Record<string, Record<string, any>>;
interface SettingsResp { data: SettingsData; weight_labels: Record<string, string> }
interface System {
  integrations: { twitch: { configured: boolean }; youtube: { configured: boolean; oauth: boolean } };
  processing: Record<string, any>;
  storage: { backend: string; used_bytes: number; quota_bytes: number; disk_free_bytes: number | null };
  demo_mode: boolean;
}
interface Conn { id: string; platform: string; status: string; login: string | null; scopes: string[]; expires_at: string | null; last_error: string | null; created_at: string }

function useSettings() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const q = useQuery({ queryKey: ["settings"], queryFn: () => get<SettingsResp>("/settings") });
  const m = useMutation({
    mutationFn: (p: SettingsData) => patch<SettingsResp>("/settings", p),
    onSuccess: (d) => { qc.setQueryData(["settings"], d); toast("Configuración guardada", "ok"); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return { q, save: m };
}

function Integrations() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const params = useSearchParams();
  const sys = useQuery({ queryKey: ["system"], queryFn: () => get<System>("/system") });
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => get<Conn[]>("/oauth/connections") });
  useEffect(() => {
    const r = params.get("oauth");
    if (r === "ok") toast(`Cuenta de ${params.get("platform")} conectada`, "ok");
    if (r === "error") toast(`No se pudo conectar ${params.get("platform")}`, "error");
  }, [params, toast]);
  const connect = async (platform: string, download = false) => {
    try {
      const r = await get<{ url: string }>(`/oauth/${platform}/start${download ? "?download_scopes=true" : ""}`);
      window.location.href = r.url;
    } catch (e) { toast(e instanceof ApiError ? e.message : "Error", "error"); }
  };
  const disconnect = useMutation({ mutationFn: (id: string) => del(`/oauth/connections/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }) });
  const i = sys.data?.integrations;
  const row = (label: string, ok: boolean | undefined, env: string, help: string) => (
    <div className="flex items-start gap-3 py-2.5">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-ok" /> : <KeyRound className="mt-0.5 h-4 w-4 text-warn" />}
      <div className="flex-1 text-sm"><div>{label}</div><p className="text-xs text-muted">{ok ? "Configurado en el servidor." : <>Falta <code className="kbd">{env}</code> en el archivo .env del backend. {help}</>}</p></div>
    </div>
  );
  return (
    <Card>
      <CardHeader title="Integraciones" icon={<Plug className="h-4 w-4" />} subtitle="Las credenciales nunca se guardan en el código: van en .env y los tokens OAuth se cifran en la base de datos." />
      <div className="divide-y divide-line px-4">
        {row("Twitch API (Helix)", i?.twitch.configured, "STREAMCUT_TWITCH_CLIENT_ID / _SECRET", "Créalas en dev.twitch.tv/console.")}
        {row("YouTube Data API", i?.youtube.configured, "STREAMCUT_YOUTUBE_API_KEY", "Créala en console.cloud.google.com.")}
        {row("OAuth de Google (opcional)", i?.youtube.oauth, "STREAMCUT_GOOGLE_CLIENT_ID / _SECRET", "Solo para acceder a tus propias emisiones.")}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-4">
        <button className="btn-secondary" disabled={!i?.twitch.configured} onClick={() => connect("twitch")}><Link2 className="h-4 w-4" />Conectar Twitch</button>
        <button className="btn-secondary" disabled={!i?.twitch.configured} onClick={() => connect("twitch", true)} title="Para descargar clips de tu propio canal o de canales donde eres editor">Conectar Twitch (con descarga de clips)</button>
        <button className="btn-secondary" disabled={!i?.youtube.oauth} onClick={() => connect("youtube")}><Link2 className="h-4 w-4" />Conectar YouTube</button>
      </div>
      {(conns.data?.length ?? 0) > 0 && (
        <div className="divide-y divide-line border-t border-line">
          {conns.data!.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone={c.status === "active" ? "ok" : "danger"}>{c.platform}</Badge>
              <span>{c.login ?? "—"}</span>
              <span className="flex flex-wrap gap-1">{c.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</span>
              {c.last_error && <span className="text-xs text-danger">{c.last_error}</span>}
              <span className="ml-auto text-xs text-faint">{fmtDate(c.created_at)}</span>
              <button className="btn-ghost h-7 text-xs" onClick={() => disconnect.mutate(c.id)}><Unplug className="h-3.5 w-3.5" />Desconectar</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

interface Target { platform: string; label: string; configured: boolean; connected: boolean; account: string | null; ready: boolean; reason: string | null }

function SocialAccounts() {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const targets = useQuery({ queryKey: ["publish-targets"], queryFn: () => get<Target[]>("/oauth/publish-targets") });
  const [igToken, setIgToken] = useState("");
  const connect = async (platform: string) => {
    try {
      const r = await get<{ url: string }>(`/oauth/${platform}/start`);
      window.location.href = r.url;
    } catch (e) { toast(e instanceof ApiError ? e.message : "Error", "error"); }
  };
  const saveIg = useMutation({
    mutationFn: () => post("/oauth/instagram/token", { token: igToken }),
    onSuccess: () => { setIgToken(""); toast("Cuenta de Instagram conectada", "ok"); qc.invalidateQueries({ queryKey: ["publish-targets"] }); qc.invalidateQueries({ queryKey: ["connections"] }); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  const env: Record<string, string> = {
    youtube: "STREAMCUT_GOOGLE_CLIENT_ID / _SECRET", tiktok: "STREAMCUT_TIKTOK_CLIENT_KEY / _SECRET",
    instagram: "STREAMCUT_INSTAGRAM_APP_ID / _SECRET",
  };
  return (
    <Card>
      <CardHeader title="Publicación en redes sociales" icon={<Send className="h-4 w-4" />}
        subtitle="Cuentas donde se publican los clips editados con el botón «Publicar»" />
      <div className="divide-y divide-line">
        {targets.data?.map((t) => (
          <div key={t.platform} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {t.ready ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <KeyRound className="h-4 w-4 text-warn" />}
            <div className="min-w-0 flex-1 text-sm">
              <div>{t.label} {t.account && <span className="text-muted">· {t.account}</span>}</div>
              <p className="text-xs text-muted">
                {t.ready ? "Lista para publicar." : t.configured || t.connected ? t.reason :
                  <>Falta <code className="kbd">{env[t.platform]}</code> en el archivo .env (ver README).</>}
              </p>
            </div>
            <button className="btn-secondary h-8 text-xs" disabled={!t.configured} onClick={() => connect(t.platform)}>
              <Link2 className="h-3.5 w-3.5" />{t.connected ? "Reconectar" : "Conectar"}
            </button>
          </div>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); if (igToken.trim()) saveIg.mutate(); }}>
        <div className="min-w-64 flex-1">
          <Field label="O pega un token de Instagram" hint="Generado en developers.facebook.com → tu app → API de Instagram → «Generar token». Útil porque Instagram exige HTTPS para el botón Conectar.">
            <input className="input" type="password" value={igToken} onChange={(e) => setIgToken(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <button className="btn-secondary" disabled={!igToken.trim() || saveIg.isPending}>{saveIg.isPending && <Spinner />}Guardar token</button>
      </form>
      <p className="border-t border-line px-4 py-3 text-xs text-faint">
        Mientras tus apps de desarrollador no estén verificadas o auditadas, YouTube y TikTok publican los vídeos en privado.
      </p>
    </Card>
  );
}

function Detection({ data, labels, onSave, saving }: { data: SettingsData; labels: Record<string, string>; onSave: (p: SettingsData) => void; saving: boolean }) {
  const [det, setDet] = useState(data.detection);
  const [clip, setClip] = useState(data.clipping);
  const [ret, setRet] = useState(data.retention);
  const w = det.weights as Record<string, number>;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <Card>
        <CardHeader title="Detección y puntuación" subtitle="Pesos de cada señal en la puntuación 0-100 (se normalizan automáticamente)" />
        <div className="grid gap-x-8 gap-y-3 p-4 md:grid-cols-2">
          {Object.entries(labels).map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 text-muted">{label}</span>
              <input type="range" min={0} max={0.5} step={0.01} value={w[k] ?? 0} className="flex-1 accent-[var(--color-accent)]" aria-label={label}
                onChange={(e) => setDet({ ...det, weights: { ...w, [k]: +e.target.value } })} />
              <span className="w-10 text-right tabular-nums text-xs text-faint">{Math.round(((w[k] ?? 0) / total) * 100)}%</span>
            </div>
          ))}
        </div>
        <div className="grid gap-4 border-t border-line p-4 md:grid-cols-4">
          <Field label="Duración"><Select value={det.duration_mode} onChange={(v) => setDet({ ...det, duration_mode: v })} options={[{ value: "auto", label: "Automática" }, ...["15", "30", "45", "60"].map((x) => ({ value: x, label: `${x} s` }))]} /></Field>
          <Field label={`Sensibilidad ${Number(det.sensitivity).toFixed(1)}`}><input type="range" min={0.5} max={2} step={0.1} value={det.sensitivity} onChange={(e) => setDet({ ...det, sensitivity: +e.target.value })} className="w-full accent-[var(--color-accent)]" /></Field>
          <Field label="Puntuación mínima"><input className="input" type="number" min={0} max={100} value={det.min_score} onChange={(e) => setDet({ ...det, min_score: +e.target.value })} /></Field>
          <Field label="Candidatos máximos"><input className="input" type="number" min={1} max={100} value={det.max_candidates} onChange={(e) => setDet({ ...det, max_candidates: +e.target.value })} /></Field>
          <Toggle checked={det.transcription} onChange={(v) => setDet({ ...det, transcription: v })} label="Transcripción" />
          <Toggle checked={det.visual_analysis} onChange={(v) => setDet({ ...det, visual_analysis: v })} label="Análisis visual" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Clips automáticos (vídeos importados)" />
        <div className="grid gap-4 p-4 md:grid-cols-4">
          <Toggle checked={clip.auto_create_clips} onChange={(v) => setClip({ ...clip, auto_create_clips: v })} label="Crear clips automáticamente" />
          <Toggle checked={clip.auto_edit} onChange={(v) => setClip({ ...clip, auto_edit: v })} label="Edición automática" />
          <Toggle checked={clip.subtitles} onChange={(v) => setClip({ ...clip, subtitles: v })} label="Subtítulos" />
          <Toggle checked={clip.auto_render} onChange={(v) => setClip({ ...clip, auto_render: v })} label="Renderizar MP4" />
          <Field label="Clips máximos por vídeo"><input className="input" type="number" min={0} max={100} value={clip.max_clips_per_source} onChange={(e) => setClip({ ...clip, max_clips_per_source: +e.target.value })} /></Field>
          <Field label="Formato"><Select value={clip.format} onChange={(v) => setClip({ ...clip, format: v })} options={["9:16", "16:9", "1:1"].map((f) => ({ value: f, label: f }))} /></Field>
          <Field label="Plantilla (slug)"><input className="input" value={clip.template_slug} onChange={(e) => setClip({ ...clip, template_slug: e.target.value })} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Retención de datos" />
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Días en la papelera antes de borrar"><input className="input" type="number" min={1} value={ret.trash_days} onChange={(e) => setRet({ ...ret, trash_days: +e.target.value })} /></Field>
          <Field label="Días que se conservan las grabaciones de directo" hint="Los clips renderizados se conservan; 0 = siempre"><input className="input" type="number" min={0} value={ret.keep_live_recordings_days} onChange={(e) => setRet({ ...ret, keep_live_recordings_days: +e.target.value })} /></Field>
        </div>
      </Card>
      <div className="flex justify-end"><button className="btn-primary" disabled={saving} onClick={() => onSave({ detection: det, clipping: clip, retention: ret })}>{saving ? <Spinner /> : <Save className="h-4 w-4" />}Guardar cambios</button></div>
    </>
  );
}

function SystemInfo() {
  const sys = useQuery({ queryKey: ["system"], queryFn: () => get<System>("/system") });
  const toast = useApp((s) => s.toast);
  const [cur, setCur] = useState(""); const [nw, setNw] = useState("");
  const p = sys.data?.processing;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Sistema" />
        <dl className="grid grid-cols-2 gap-y-2 p-4 text-sm">
          <dt className="text-muted">FFmpeg</dt><dd className="truncate">{p?.ffmpeg ?? "No encontrado"}</dd>
          <dt className="text-muted">Transcripción</dt><dd>{p?.whisper_available ? `faster-whisper (${p.whisper_model})` : "No disponible"}</dd>
          <dt className="text-muted">Aceleración</dt><dd>{p?.device === "cuda" ? "GPU NVIDIA (CUDA)" : "CPU"} · {p?.compute_type}</dd>
          <dt className="text-muted">Codificador</dt><dd>{p?.hw_encoder ?? "libx264 (CPU)"}</dd>
          <dt className="text-muted">Modo</dt><dd>{p?.run_mode} · cola {p?.broker}</dd>
          <dt className="text-muted">Almacenamiento</dt><dd>{sys.data?.storage.backend} · {fmtBytes(sys.data?.storage.used_bytes)} usados · {fmtBytes(sys.data?.storage.disk_free_bytes)} libres</dd>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Seguridad de la cuenta" />
        <form className="space-y-3 p-4" onSubmit={async (e) => {
          e.preventDefault();
          try { await post("/auth/password", { current_password: cur, new_password: nw }); toast("Contraseña cambiada", "ok"); setCur(""); setNw(""); }
          catch (err) { toast(err instanceof ApiError ? err.message : "Error", "error"); }
        }}>
          <Field label="Contraseña actual"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
          <Field label="Nueva contraseña" hint="Mínimo 10 caracteres. Se cerrarán las demás sesiones."><input className="input" type="password" minLength={10} value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" required /></Field>
          <button className="btn-secondary">Cambiar contraseña</button>
        </form>
      </Card>
    </div>
  );
}

function SettingsPage() {
  const { q, save } = useSettings();
  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" description="Integraciones, motor de detección, clips automáticos, retención y sistema." />
      <Integrations />
      <SocialAccounts />
      {q.data ? <Detection data={q.data.data} labels={q.data.weight_labels} onSave={(p) => save.mutate(p)} saving={save.isPending} /> : <Spinner />}
      <SystemInfo />
    </div>
  );
}

export default function Page() {
  return <Suspense><SettingsPage /></Suspense>;
}
