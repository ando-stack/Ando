"use client";

import { AlertTriangle, Film, FileArchive, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { ReplayPlayerPicker } from "@/components/ReplayPlayerPicker";
import { ReportView } from "@/components/ReportView";
import { ReviewWorkspace } from "@/components/review/ReviewWorkspace";
import { Uploader } from "@/components/Uploader";
import { Badge, Button, Card, CardHeader, ErrorBox, Loading, PageHeader, Progress, Tabs, cx } from "@/components/ui";
import { del, post } from "@/lib/api";
import { fmtBytes, fmtDate, fmtTime } from "@/lib/format";
import { useApi, useInterval } from "@/lib/hooks";
import type { AnalysisBundle, Match } from "@/lib/types";

type Tab = "review" | "report" | "timeline" | "files";

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const m = useApi<Match>(`/matches/${id}`);
  const b = useApi<AnalysisBundle>(`/matches/${id}/analysis`);
  const [tab, setTab] = useState<Tab>("review");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showConvert, setShowConvert] = useState(false);
  const match = m.data;
  const running = match?.job && (match.job.status === "queued" || match.job.status === "running");

  useInterval(async () => {
    const before = match?.status;
    await m.reload();
    if (before !== "completed") b.reload();
  }, running ? 2500 : null);
  useEffect(() => { if (match?.status === "completed") b.reload(); }, [match?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (m.loading && !match) return <Loading />;
  if (m.error) return <ErrorBox message={m.error} onRetry={m.reload} />;
  if (!match) return null;

  const fileKind = match.source_type;
  const media = match.media?.find((x) => x.kind === fileKind);
  const replayFile = match.media?.find((x) => x.kind === "replay");
  const analysis = b.data?.analysis;
  const needsTarget = match.source_type === "replay" && media && !match.target_player_ref && !analysis;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); await m.reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={match.source_type === "video" ? "Partida · Vídeo" : "Partida · Replay"}
        title={match.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Link href={`/players/${match.player_id}`} className="hover:text-brand">{match.player_name}</Link>·<span>{match.game_mode || "—"}</span>·<span>{fmtDate(match.played_at || match.created_at)}</span><MatchStatusBadge status={match.status} /></span>}
        actions={<>
          {media && !running && <Button variant={analysis ? "secondary" : "primary"} icon={analysis ? <RefreshCw className="size-4" /> : <Play className="size-4" />} loading={busy} disabled={!!needsTarget} onClick={() => act(() => post(`/matches/${id}/analyze`))}>{analysis ? "Re-analizar" : "Iniciar análisis"}</Button>}
          {running && <Button icon={<Square className="size-4" />} loading={busy} onClick={() => act(() => post(`/matches/${id}/cancel`))}>Cancelar análisis</Button>}
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => { if (confirm("¿Eliminar la partida con sus archivos, análisis y notas?")) { await del(`/matches/${id}`); router.replace(`/players/${match.player_id}`); } }}>Eliminar</Button>
        </>}
      />
      {err && <div className="mb-4"><ErrorBox message={err} /></div>}

      {!media && (
        <Card className="mb-4"><CardHeader title={fileKind === "video" ? "Sube el vídeo de la partida" : "Sube la replay"} /><div className="p-5"><Uploader matchId={id} kind={fileKind} onDone={() => m.reload()} /></div></Card>
      )}

      {needsTarget && (
        <Card className="mb-4"><CardHeader title="¿Qué jugador de la replay quieres analizar?" /><div className="p-5"><ReplayPlayerPicker matchId={id} value={match.target_player_ref} onPicked={() => m.reload()} /></div></Card>
      )}

      {running && match.job && (
        <Card className="mb-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="font-medium">{match.job.status === "queued" ? "En cola" : match.job.stage}</div><div className="text-sm text-ink-3">{match.job.message}</div></div>
            <div className="tabular text-2xl font-semibold">{Math.round(match.job.progress)}%</div>
          </div>
          <div className="mt-3"><Progress value={match.job.progress} /></div>
          <PipelineSteps source={match.source_type} stage={match.job.stage} />
          <p className="mt-3 text-xs text-ink-3">Se ejecuta en segundo plano: puedes salir de esta página. El vídeo nunca se envía entero a la IA, solo fotogramas seleccionados por segmentos.</p>
        </Card>
      )}

      {(match.status === "failed" || match.status === "incompatible") && match.job?.error && !running && (
        <Card className="mb-4 border-[#4a2327] p-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-sev-critical" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{match.status === "incompatible" ? "No se puede analizar este archivo" : "El análisis falló"}</div>
              <p className="mt-1 text-sm text-ink-2">{match.job.error}</p>
              <p className="mt-1 text-xs text-ink-3">No se han generado estadísticas para este archivo.</p>
              {match.source_type === "replay" && <Button size="sm" className="mt-3" onClick={() => setShowConvert(true)}>Convertir a vídeo con el Modo Repetición</Button>}
            </div>
          </div>
        </Card>
      )}

      {(showConvert || (match.source_type === "replay" && analysis && tab === "files")) && (
        <Card className="mb-4">
          <CardHeader title="Convertir la replay en vídeo" subtitle="Para analizar posicionamiento visual, builds, edits y aim" />
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
              <li>Copia el .replay a <span className="font-mono text-xs">Documentos/FortniteGame/Saved/Demos</span> (si no está ya) y abre Fortnite.</li>
              <li>Ve a <b>Carrera → Repeticiones</b> y abre la partida.</li>
              <li>Selecciona la cámara en <b>tercera persona</b> siguiendo al jugador y oculta solo lo necesario del HUD (mantén vida, materiales y minimapa visibles).</li>
              <li>Graba a 1080p 60fps con OBS, ShadowPlay o la grabación de la consola, desde el salto del autobús hasta el final.</li>
              <li>Sube aquí el vídeo: la partida pasará a analizarse como vídeo y la replay se conserva.</li>
            </ol>
            <Uploader matchId={id} kind="video" onDone={() => { setShowConvert(false); m.reload(); }} />
          </div>
        </Card>
      )}

      {analysis && b.data && (
        <>
          <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[
            { value: "review", label: match.source_type === "video" || analysis.source_type === "video" ? "VOD Review" : "Revisión de replay" },
            { value: "report", label: "Informe" },
            { value: "timeline", label: "Cronología" },
            { value: "files", label: "Datos y archivos" },
          ]} /></div>
          {tab === "review" && <ReviewWorkspace match={match} bundle={b.data} onChanged={b.reload} />}
          {tab === "report" && <ReportView match={match} bundle={b.data} onOpenFinding={() => setTab("review")} />}
          {tab === "timeline" && <TimelineTab bundle={b.data} />}
          {tab === "files" && <FilesTab match={match} bundle={b.data} onChanged={() => { m.reload(); b.reload(); }} />}
        </>
      )}
      {!analysis && media && !running && match.status !== "failed" && match.status !== "incompatible" && !needsTarget && (
        <Card className="p-8 text-center text-sm text-ink-3">Archivo listo. Pulsa <b className="text-ink">Iniciar análisis</b> para comenzar.</Card>
      )}
      {!analysis && media && <div className="mt-4"><FilesTab match={match} bundle={b.data || { analysis: null, findings: [], notes: [] }} onChanged={() => m.reload()} /></div>}
    </div>
  );
}

const VIDEO_STAGES = ["Validando vídeo", "Preparando reproducción", "Detectando momentos relevantes", "Leyendo HUD", "Aplicando reglas de coaching", "Extrayendo fotogramas", "Transcribiendo audio", "Análisis visual por segmentos", "Construyendo cronología", "Módulos de coaching", "Redactando informe"];
const REPLAY_STAGES = ["Interpretando replay", "Construyendo cronología", "Aplicando reglas de coaching", "Módulos de coaching", "Redactando informe"];

function PipelineSteps({ source, stage }: { source: string; stage: string | null }) {
  const steps = source === "video" ? VIDEO_STAGES : REPLAY_STAGES;
  const idx = steps.indexOf(stage || "");
  return (
    <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {steps.map((s, i) => (
        <li key={s} className={cx("flex items-center gap-1.5", i < idx ? "text-ink-2" : i === idx ? "text-ink" : "text-ink-3")}>
          <span className={cx("size-1.5 rounded-full", i < idx ? "bg-brand" : i === idx ? "animate-pulse bg-brand" : "bg-line-strong")} />{s}
        </li>
      ))}
    </ol>
  );
}

function TimelineTab({ bundle }: { bundle: AnalysisBundle }) {
  const items = bundle.analysis!.timeline.filter((x) => x.kind !== "frame" && x.kind !== "hud");
  const frames = bundle.analysis!.timeline.filter((x) => x.kind === "frame" || x.kind === "hud");
  const [showFrames, setShowFrames] = useState(false);
  const list = (showFrames ? bundle.analysis!.timeline : items).slice(0, 2000);
  return (
    <Card>
      <CardHeader title="Cronología verificada" subtitle="Eventos, observaciones y voz detectados, con su tiempo exacto. Es la base de todos los errores."
        action={frames.length > 0 ? <label className="flex items-center gap-2 text-xs text-ink-3"><input type="checkbox" checked={showFrames} onChange={(e) => setShowFrames(e.target.checked)} className="accent-[var(--color-brand)]" />Incluir fotogramas ({frames.length})</label> : null} />
      <ul className="divide-y divide-line">
        {list.map((x) => (
          <li key={x.id} className="grid grid-cols-[64px_88px_1fr] gap-3 px-5 py-2.5 text-sm">
            <span className="tabular font-mono text-xs text-brand">{fmtTime(x.t)}</span>
            <span className="truncate text-xs text-ink-3">{x.kind === "hud" ? `${x.id} · HUD` : x.kind === "frame" ? `${x.id} · ${x.situation}` : x.kind === "speech" ? "Voz" : x.kind === "observation" ? `${x.obs_kind}` : x.type}</span>
            <span className="text-ink-2">{x.kind === "hud" ? ((x as any).storm >= 0.35 ? "Tinte de tormenta" : "") : (x.description || x.text)}{x.kind === "frame" && x.hud && <HudLine hud={x.hud} />}{x.kind === "hud" && x.hud && <HudLine hud={x.hud} />}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HudLine({ hud }: { hud: Record<string, any> }) {
  const parts = [hud.health != null && `HP ${hud.health}/${hud.shield ?? "?"}`, hud.wood != null && `Mats ${hud.wood}/${hud.brick}/${hud.metal}`, hud.players_remaining != null && `Quedan ${hud.players_remaining}`].filter(Boolean);
  return parts.length ? <span className="ml-2 font-mono text-[11px] text-ink-3">{parts.join(" · ")}</span> : null;
}

function FilesTab({ match, bundle, onChanged }: { match: Match; bundle: AnalysisBundle; onChanged: () => void }) {
  const a = bundle.analysis;
  const cov = a?.coverage || {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Archivos" subtitle="Puedes borrar el vídeo para liberar espacio; el análisis se conserva" />
        <ul className="divide-y divide-line">
          {(match.media || []).map((x) => (
            <li key={x.id} className="flex items-start gap-3 px-5 py-3">
              <span className="mt-0.5 text-ink-3">{x.kind === "replay" ? <FileArchive className="size-4" /> : <Film className="size-4" />}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{x.kind === "proxy" ? "Versión de reproducción (H.264)" : x.original_name}</div>
                <div className="tabular text-xs text-ink-3">
                  {fmtBytes(x.size_bytes)}{x.duration_s ? ` · ${fmtTime(x.duration_s)}` : ""}{x.width ? ` · ${x.width}×${x.height}` : ""}{x.fps ? ` · ${x.fps} fps` : ""}{x.video_codec ? ` · ${x.video_codec}` : ""}{x.kind === "video" ? (x.has_audio ? ` · audio ${x.audio_codec}` : " · sin audio") : ""}
                  {x.kind === "replay" && ` · ${String(x.meta?.branch || "")}`}
                </div>
              </div>
              {x.kind !== "proxy" && <button className="text-ink-3 hover:text-sev-critical" aria-label="Borrar archivo" onClick={async () => { if (confirm("¿Borrar este archivo?")) { await del(`/matches/${match.id}/media/${x.id}`); onChanged(); } }}><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      </Card>
      {a && (
        <Card>
          <CardHeader title="Cobertura del análisis" subtitle="Qué datos se usaron realmente" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-5 text-sm">
            {a.source_type === "video" && cov.mode === "rules" ? (
              <>
                <Dt k="Modo" v="Reglas (sin IA generativa)" /><Dt k="Muestras de HUD" v={a.stats.hud_samples} />
                <Dt k="Vida legible" v={`${a.stats.hud_legible_pct}%`} /><Dt k="Materiales legibles" v={`${a.stats.materials_legible_pct}%`} />
                <Dt k="HUD" v={cov.hud_calibrated ? "Calibrado" : "Sin calibrar (aproximado)"} /><Dt k="Peleas detectadas" v={a.stats.fights_detected} />
                <Dt k="Tiempo en tormenta" v={`${a.stats.storm_seconds} s`} /><Dt k="Fases por" v={cov.phase_method === "hud_players_remaining" ? "HUD (jugadores restantes)" : "tiempo (estimado)"} />
              </>
            ) : a.source_type === "video" ? (
              <>
                <Dt k="Fotogramas analizados" v={cov.frames} /><Dt k="Con gameplay" v={cov.gameplay_frames} />
                <Dt k="Segmentos" v={`${cov.segments_analysed}/${cov.segments_total}`} /><Dt k="Minutos de gameplay" v={cov.analysed_minutes} />
                <Dt k="Fases detectadas por" v={cov.phase_method === "hud_players_remaining" ? "HUD (jugadores restantes)" : "tiempo (estimado)"} />
                <Dt k="HUD legible" v={`${a.stats.hud_legible_pct}%`} />
                <Dt k="Audio" v={cov.has_audio ? (cov.transcript_lines ? `${cov.transcript_lines} frases transcritas` : cov.speech_to_text) : "Sin audio"} />
                <Dt k="Afirmaciones sin evidencia descartadas" v={cov.dropped_unverified_claims} />
              </>
            ) : (
              <>
                <Dt k="Adaptador" v={cov.adapter} /><Dt k="Versión Fortnite" v={cov.version?.season_label || cov.version?.branch} />
                <Dt k="Eventos del jugador" v={cov.events} /><Dt k="No disponible" v={(cov.unavailable || []).join(", ") || "—"} />
                <Dt k="Eliminaciones" v={a.stats.eliminations} /><Dt k="Knocks" v={a.stats.knocks} />
                <Dt k="Puesto" v={a.stats.placement ?? "—"} /><Dt k="Distancia recorrida" v={a.stats.distance_travelled_m != null ? `${a.stats.distance_travelled_m} m` : "—"} />
              </>
            )}
            <Dt k="Modelo" v={a.model} /><Dt k="Llamadas a IA" v={a.usage?.calls} />
          </dl>
          {cov.warnings?.length > 0 && <ul className="border-t border-line px-5 py-3 text-xs text-ink-3">{cov.warnings.map((w: string) => <li key={w}>· {w}</li>)}</ul>}
          {cov.not_verifiable?.length > 0 && (
            <details className="border-t border-line px-5 py-3 text-xs text-ink-3"><summary className="cursor-pointer">No verificable por calidad de imagen ({cov.not_verifiable.length})</summary><ul className="mt-2 space-y-1">{cov.not_verifiable.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></details>
          )}
          {a.stats.recorder_match_stats && (
            <div className="border-t border-line px-5 py-3">
              <div className="mb-2 text-xs font-medium text-ink-3">Estadísticas finales de la replay (jugador que grabó)</div>
              <div className="flex flex-wrap gap-1.5">{Object.entries(a.stats.recorder_match_stats).filter(([k]) => k !== "time_ms").map(([k, v]) => <Badge key={k}>{k}: {String(v)}</Badge>)}</div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Dt({ k, v }: { k: string; v: any }) {
  return <><dt className="text-ink-3">{k}</dt><dd className="tabular text-right">{v ?? "—"}</dd></>;
}
