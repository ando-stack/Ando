"use client";

import { Pause, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { AnalysisBundle, Finding, Match } from "@/lib/types";
import { Button, Card, CardHeader, Tabs, cx } from "../ui";
import { AddFindingModal, FilterBar, FindingDetail, FindingsList, applyFilters, defaultFilters } from "./FindingsPanel";
import { NotesPanel } from "./NotesPanel";
import { Timeline } from "./Timeline";
import { PlayerHandle, VideoPlayer } from "./VideoPlayer";

/** VOD review workspace: player + markers + filters + detail + notes.
 *  Works with a real video, or with a virtual clock over replay time. */
export function ReviewWorkspace({ match, bundle, onChanged }: { match: Match; bundle: AnalysisBundle; onChanged: () => void }) {
  const isVideo = bundle.analysis?.source_type === "video";
  const playable = match.media?.find((m) => m.kind === "video") || null;
  const [src, setSrc] = useState<string | null>(null);
  const [srcMsg, setSrcMsg] = useState<string | null>(null);
  const [frameBase, setFrameBase] = useState<{ base: string; token: string } | null>(null);
  const [filters, setFilters] = useState(defaultFilters);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [side, setSide] = useState<"errors" | "notes">("errors");
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(0);
  const player = useRef<PlayerHandle>(null);
  const clock = useVirtualClock(isVideo ? 0 : (bundle.analysis?.stats?.replay_length_s || 0));

  useEffect(() => {
    if (!isVideo) return;
    if (!playable) { setSrcMsg("El vídeo original se eliminó. Los errores y el informe se conservan."); return; }
    api<{ url: string | null; reason?: string }>(`/media/${playable.id}/url`).then((r) => { setSrc(r.url); if (!r.url) setSrcMsg(r.reason || "No reproducible"); }).catch((e) => setSrcMsg(e.message));
  }, [isVideo, playable?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bundle.analysis || !isVideo) return;
    api<{ base: string; token: string }>(`/analyses/${bundle.analysis.id}/frames-token`).then(setFrameBase).catch(() => {});
  }, [bundle.analysis?.id, isVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameUrl = frameBase ? (label: string) => `${frameBase.base}/${label}?token=${frameBase.token}` : null;
  const visible = useMemo(() => applyFilters(bundle.findings, filters), [bundle.findings, filters]);
  const sel = selected ? bundle.findings.find((f) => f.id === selected.id) || null : null;

  const seek = useCallback((t: number, play = false) => {
    if (isVideo) player.current?.seek(t, play);
    else clock.seek(t);
  }, [isVideo, clock]);
  const pick = (f: Finding) => { setSelected(f); seek(Math.max(0, f.t_start - (isVideo ? 2 : 0))); };
  const currentTime = () => (isVideo ? player.current?.currentTime() || 0 : clock.t);
  const duration = isVideo ? (playable?.duration_s || bundle.analysis?.stats?.duration_s || 0) : clock.duration;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        {isVideo ? (
          src ? (
            <VideoPlayer ref={player} src={src} duration={duration} findings={visible} notes={bundle.notes} selectedId={sel?.id || null} onSelect={pick} onTime={setNow} />
          ) : (
            <Card className="grid aspect-video place-items-center p-6 text-center text-sm text-ink-3">{srcMsg || "Cargando vídeo…"}</Card>
          )
        ) : (
          <Card className="overflow-hidden">
            <ReplayMap bundle={bundle} t={clock.t} />
            <div className="space-y-3 border-t border-line px-4 pb-3 pt-1">
              <Timeline duration={clock.duration} current={clock.t} findings={visible} notes={bundle.notes} selectedId={sel?.id || null} onSeek={clock.seek} onSelect={pick} />
              <div className="flex items-center gap-2">
                <button onClick={clock.toggle} className="focus-ring grid size-9 place-items-center rounded-lg bg-brand text-white" aria-label={clock.playing ? "Pausa" : "Reproducir"}>{clock.playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                <span className="tabular font-mono text-xs text-ink-2">{fmtTime(clock.t)} <span className="text-ink-3">/ {fmtTime(clock.duration)}</span></span>
                <div className="ml-auto flex rounded-lg border border-line bg-surface-2 p-0.5">
                  {[1, 4, 10, 20].map((s) => <button key={s} onClick={() => clock.setSpeed(s)} className={cx("tabular rounded-md px-2 py-1 text-xs", clock.speed === s ? "bg-brand text-white" : "text-ink-3")}>{s}x</button>)}
                </div>
              </div>
              <p className="text-xs text-ink-3">Revisión sobre datos de la replay (sin imagen). Para revisar visualmente, graba la partida en el Modo Repetición y súbela como vídeo.</p>
            </div>
          </Card>
        )}

        <Card className="p-5">
          {sel ? (
            <FindingDetail f={sel} frameUrl={frameUrl} onSeek={(t) => seek(t)} onChanged={onChanged} />
          ) : (
            <div className="py-6 text-center text-sm text-ink-3">Selecciona un error de la lista o un marcador de la línea temporal para ver el detalle y saltar al momento exacto.</div>
          )}
        </Card>
      </div>

      <Card className="flex max-h-[calc(100dvh-140px)] min-h-[420px] flex-col xl:sticky xl:top-6">
        <div className="px-4 pt-2"><Tabs value={side} onChange={setSide} items={[{ value: "errors", label: `Errores (${visible.length})` }, { value: "notes", label: `Notas (${bundle.notes.length})` }]} /></div>
        {side === "errors" ? (
          <>
            <div className="border-b border-line p-4">
              <FilterBar findings={bundle.findings} filters={filters} onChange={setFilters} />
              <Button size="sm" className="mt-3 w-full" icon={<Plus className="size-4" />} onClick={() => { player.current?.pause(); setAdding(true); }}>Marcador del coach en {fmtTime(isVideo ? now : clock.t)}</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto"><FindingsList findings={visible} selectedId={sel?.id || null} onPick={pick} /></div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <NotesPanel matchId={match.id} notes={bundle.notes} currentTime={currentTime} onSeek={(t) => seek(t)} onChanged={onChanged} />
          </div>
        )}
      </Card>
      <AddFindingModal open={adding} onClose={() => setAdding(false)} matchId={match.id} t={isVideo ? now : clock.t} onSaved={() => { setAdding(false); onChanged(); }} />
    </div>
  );
}

function useVirtualClock(duration: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (n: number) => {
      setT((x) => { const v = x + ((n - last) / 1000) * speed; if (v >= duration) { setPlaying(false); return duration; } return v; });
      last = n;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);
  return useMemo(() => ({ t, duration, playing, speed, setSpeed, toggle: () => setPlaying((p) => !p), seek: (x: number) => setT(Math.max(0, Math.min(duration, x))) }), [t, duration, playing, speed]);
}

/** Top-down plot of the analysed player's positions and storm circles (when the replay provides them). */
function ReplayMap({ bundle, t }: { bundle: AnalysisBundle; t: number }) {
  const rd = bundle.analysis?.replay_data;
  const events = bundle.analysis?.timeline || [];
  const recent = events.filter((e) => e.t <= t).slice(-4).reverse();
  const pos = rd?.positions || [];
  if (!pos.length) {
    return (
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1.2fr]">
        <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-line text-center text-sm text-ink-3">Esta replay no aporta posiciones sincronizadas.<br />Se muestran los eventos con su tiempo exacto.</div>
        <EventFeed items={recent} />
      </div>
    );
  }
  const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
  const zs = rd!.zones;
  const minX = Math.min(...xs, ...zs.map((z) => z.x - z.r)), maxX = Math.max(...xs, ...zs.map((z) => z.x + z.r));
  const minY = Math.min(...ys, ...zs.map((z) => z.y - z.r)), maxY = Math.max(...ys, ...zs.map((z) => z.y + z.r));
  const span = Math.max(maxX - minX, maxY - minY) * 1.05 || 1;
  const cx0 = (minX + maxX) / 2, cy0 = (minY + maxY) / 2;
  const P = (x: number, y: number) => [((x - cx0) / span + 0.5) * 1000, ((y - cy0) / span + 0.5) * 1000];
  const path = pos.filter((p) => p.t <= t).map((p, i) => `${i ? "L" : "M"}${P(p.x, p.y).join(",")}`).join(" ");
  const cur = [...pos].reverse().find((p) => p.t <= t) || pos[0];
  const zone = [...zs].reverse().find((z) => z.t != null && z.t <= t);
  const [cxp, cyp] = P(cur.x, cur.y);
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1.2fr]">
      <svg viewBox="0 0 1000 1000" className="aspect-square w-full rounded-lg border border-line bg-[#0a0c10]" role="img" aria-label="Recorrido del jugador y zonas">
        {zs.filter((z) => z.t != null && z.t <= t).map((z, i) => { const [a, b] = P(z.x, z.y); return <circle key={i} cx={a} cy={b} r={(z.r / span) * 1000} fill="none" stroke={z === zone ? "#e3b23c" : "#30374a"} strokeWidth={z === zone ? 3 : 1.5} strokeDasharray={z === zone ? undefined : "6 6"} />; })}
        <path d={pos.map((p, i) => `${i ? "L" : "M"}${P(p.x, p.y).join(",")}`).join(" ")} fill="none" stroke="#3a4256" strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" />
        <path d={path} fill="none" stroke="#2e7dff" strokeWidth={3} strokeLinejoin="round" />
        <circle cx={cxp} cy={cyp} r={11} fill="#2e7dff" stroke="#fff" strokeWidth={3} />
      </svg>
      <div>
        <div className="mb-2 text-xs text-ink-3">{zone ? "Círculo amarillo: zona segura activa" : "Sin cierre de zona todavía"}</div>
        <EventFeed items={recent} />
      </div>
    </div>
  );
}

function EventFeed({ items }: { items: { id: string; t: number; type?: string; description?: string }[] }) {
  return (
    <ul className="space-y-2">
      {items.length === 0 && <li className="text-sm text-ink-3">Sin eventos hasta este momento.</li>}
      {items.map((e) => (
        <li key={e.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="tabular mr-2 font-mono text-xs text-brand">{fmtTime(e.t)}</span>{e.description}
        </li>
      ))}
    </ul>
  );
}
