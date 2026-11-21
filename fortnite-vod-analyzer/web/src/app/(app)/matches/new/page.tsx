"use client";

import { Check, FileArchive, Film } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MODES, PlayerForm } from "@/components/PlayerForm";
import { ReplayPlayerPicker } from "@/components/ReplayPlayerPicker";
import { Uploader } from "@/components/Uploader";
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { post } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Match, Player } from "@/lib/types";

const STEPS = ["Jugador", "Tipo", "Detalles", "Archivo", "Analizar"];

function Wizard() {
  const sp = useSearchParams();
  const router = useRouter();
  const players = useApi<Player[]>("/players");
  const status = useApi<any>("/system/status");
  const [step, setStep] = useState(0);
  const [playerId, setPlayerId] = useState(sp.get("player") || "");
  const [source, setSource] = useState<"video" | "replay">("video");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("");
  const [playedAt, setPlayedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (sp.get("player")) setStep(1); }, [sp]);
  const player = players.data?.find((p) => p.id === playerId);
  useEffect(() => { if (player && !mode) setMode(player.game_mode || ""); }, [player, mode]);

  async function createMatch() {
    setBusy(true);
    setError(null);
    try {
      const m = await post<Match>("/matches", { player_id: playerId, title, source_type: source, game_mode: mode || null, played_at: playedAt ? new Date(playedAt).toISOString() : null, notes: notes || null });
      setMatch(m);
      setStep(3);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function analyze() {
    if (!match) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/matches/${match.id}/analyze`);
      router.push(`/matches/${match.id}`);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  if (players.loading && !players.data) return <Loading />;
  const limits = status.data?.limits;

  return (
    <div className="fade-in mx-auto max-w-3xl">
      <PageHeader eyebrow="Nueva partida" title="Subir y analizar" />
      <ol className="mb-6 grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="min-w-0">
            <div className={cx("h-1 rounded-full", i <= step ? "bg-brand" : "bg-surface-3")} />
            <div className={cx("mt-2 truncate text-xs font-medium", i === step ? "text-ink" : "text-ink-3")}>{i + 1}. {s}</div>
          </li>
        ))}
      </ol>

      <Card className="p-5 sm:p-6">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold">¿Qué jugador vas a analizar?</h2>
            {players.data && players.data.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {players.data.map((p) => (
                  <button key={p.id} onClick={() => setPlayerId(p.id)} className={cx("focus-ring flex items-center gap-3 rounded-xl border p-3 text-left transition-colors", playerId === p.id ? "border-brand bg-brand-soft" : "border-line bg-surface-2 hover:border-line-strong")}>
                    <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-xs font-semibold">{p.name.slice(0, 2).toUpperCase()}</span>
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-ink-3">{[p.platform, p.game_mode, p.competitive_level].filter(Boolean).join(" · ") || "Sin detalles"}</span></span>
                    {playerId === p.id && <Check className="ml-auto size-4 text-brand" />}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-ink-3">Aún no tienes jugadores.</p>}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setNewPlayer(true)}>+ Crear jugador</Button>
              <Button variant="primary" disabled={!playerId} onClick={() => setStep(1)}>Continuar</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="font-semibold">¿Qué vas a subir?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["video", Film, "Vídeo de la partida", "MP4, MOV, MKV o WEBM grabado desde la vista del jugador. Permite el análisis completo: posicionamiento, peleas, mecánicas visibles y comunicación (si hay audio)."],
                ["replay", FileArchive, "Replay de Fortnite (.replay)", "Archivo nativo del juego. Aporta tiempos exactos de knocks/eliminaciones, estadísticas y, según la versión, posiciones y zonas. No contiene imagen: builds, edits y aim no se pueden evaluar."],
              ] as const).map(([v, Icon, t, d]) => (
                <button key={v} onClick={() => setSource(v)} className={cx("focus-ring rounded-xl border p-4 text-left transition-colors", source === v ? "border-brand bg-brand-soft" : "border-line bg-surface-2 hover:border-line-strong")}>
                  <Icon className={cx("mb-3 size-5", source === v ? "text-brand" : "text-ink-3")} />
                  <div className="font-medium">{t}</div>
                  <p className="mt-1 text-sm text-ink-3">{d}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(0)}>Atrás</Button><Button variant="primary" onClick={() => setStep(2)}>Continuar</Button></div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="font-semibold">Detalles de la partida</h2>
            <Field label="Título *"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: FNCS Heat 2 — Partida 4" maxLength={200} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Modo de juego"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">—</option>{MODES.map((m) => <option key={m}>{m}</option>)}</Select></Field>
              <Field label="Fecha de la partida"><Input type="datetime-local" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} /></Field>
            </div>
            <Field label="Contexto para el análisis" hint="Opcional: objetivo de la partida, rol en el equipo, qué quieres revisar…"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10000} /></Field>
            {error && <ErrorBox message={error} />}
            <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}>Atrás</Button><Button variant="primary" disabled={!title.trim()} loading={busy} onClick={createMatch}>Crear partida y subir</Button></div>
          </div>
        )}

        {step === 3 && match && (
          <div className="space-y-4">
            <h2 className="font-semibold">Sube {source === "video" ? "el vídeo" : "la replay"}</h2>
            <Uploader matchId={match.id} kind={source} maxMb={source === "video" ? limits?.max_video_mb : limits?.max_replay_mb} onDone={() => setUploaded(true)} />
            {source === "video" && limits && <p className="text-xs text-ink-3">Máximo {limits.max_video_minutes} min de vídeo. La subida se hace por partes y se puede reanudar si se corta la conexión.</p>}
            <div className="flex justify-end"><Button variant="primary" disabled={!uploaded} onClick={() => setStep(4)}>Continuar</Button></div>
          </div>
        )}

        {step === 4 && match && (
          <div className="space-y-4">
            {source === "replay" && !target ? (
              <>
                <h2 className="font-semibold">Selecciona el jugador de la replay</h2>
                <ReplayPlayerPicker matchId={match.id} value={null} onPicked={setTarget} />
              </>
            ) : (
              <>
                <h2 className="font-semibold">Todo listo</h2>
                <p className="text-sm text-ink-2">El análisis se ejecuta en segundo plano: puedes cerrar esta página y volver más tarde. Verás el progreso en la partida y en el dashboard.</p>
                {status.data && !status.data.ai.configured && <ErrorBox message={`La IA no está configurada en el servidor: ${status.data.ai.detail}`} />}
                {error && <ErrorBox message={error} />}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => router.push(`/matches/${match.id}`)}>Analizar más tarde</Button>
                  <Button variant="primary" loading={busy} onClick={analyze}>Iniciar análisis</Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      <Modal open={newPlayer} onClose={() => setNewPlayer(false)} title="Nuevo jugador" wide>
        <PlayerForm onSaved={async (p) => { setNewPlayer(false); await players.reload(); setPlayerId(p.id); setStep(1); }} onCancel={() => setNewPlayer(false)} />
      </Modal>
    </div>
  );
}

export default function NewMatchPage() {
  return <Suspense fallback={<Loading />}><Wizard /></Suspense>;
}
