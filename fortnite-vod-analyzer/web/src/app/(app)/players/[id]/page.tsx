"use client";

import { Check, GitCompare, Pencil, Plus, ScanText, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { HBars, ScoreLineChart } from "@/components/charts";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { PlayerForm } from "@/components/PlayerForm";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Textarea, cx } from "@/components/ui";
import { del, patch, post } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, fmtDate, scoreTone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Category, Goal, Match, Player } from "@/lib/types";

type Detail = Player & { matches: Match[]; evolution: any[]; recurring_errors: any[]; goals: Goal[] };

export default function PlayerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Detail>(`/players/${id}`);
  const [edit, setEdit] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [cmp, setCmp] = useState<string[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const analysed = data.matches.filter((m) => m.analysis);
  const lastCats = data.evolution.at(-1)?.categories || {};

  async function removePlayer() {
    if (!confirm(`¿Eliminar a ${data!.name} con todas sus partidas, vídeos y análisis? No se puede deshacer.`)) return;
    await del(`/players/${id}`);
    router.replace("/players");
  }

  async function saveNotes() {
    setSavingNotes(true);
    await patch(`/players/${id}`, { coach_notes: notes });
    setSavingNotes(false);
    setNotes(null);
    reload();
  }

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Jugador" title={data.name}
        subtitle={<span className="flex flex-wrap gap-1.5">{[data.epic_id && `Epic: ${data.epic_id}`, data.platform, data.region, data.game_mode, data.competitive_level].filter(Boolean).map((x) => <Badge key={x as string}>{x}</Badge>)}</span>}
        actions={<>
          <Link href={`/matches/new?player=${id}`}><Button variant="primary" icon={<Plus className="size-4" />}>Nueva partida</Button></Link>
          <Link href={`/players/${id}/hud`}><Button icon={<ScanText className="size-4" />}>{data.hud_calibrated ? "HUD calibrado" : "Calibrar HUD"}</Button></Link>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Editar</Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={removePlayer}>Eliminar</Button>
        </>} />

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Evolución" subtitle="Puntuación global por partida analizada" />
          <div className="p-4"><ScoreLineChart data={data.evolution} /></div>
          {Object.keys(lastCats).length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-5 py-4 text-sm sm:grid-cols-3">
              {Object.entries(lastCats).map(([k, v]) => {
                const prev = data.evolution.at(-2)?.categories?.[k];
                const d = v != null && prev != null ? (v as number) - prev : null;
                return (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink-3">{labelForScoreKey(k)}</span>
                    <span className="tabular">
                      <span className={scoreTone(v as number)}>{(v as number) ?? "—"}</span>
                      {d != null && d !== 0 && <span className={cx("ml-1.5 text-xs", d > 0 ? "text-ok" : "text-sev-critical")}>{d > 0 ? "+" : ""}{d}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Errores recurrentes" subtitle="Acumulado en todos sus análisis" />
          <div className="p-5"><HBars rows={data.recurring_errors.map((r) => ({ key: r.category, label: CATEGORY_LABEL[r.category as Category] || r.category, value: r.count }))} /></div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Historial de partidas" subtitle={cmp.length ? `Selecciona dos partidas analizadas para comparar (${cmp.length}/2)` : "Marca dos partidas analizadas para compararlas"}
            action={<Button size="sm" icon={<GitCompare className="size-4" />} disabled={cmp.length !== 2} onClick={() => router.push(`/players/${id}/compare?a=${cmp[0]}&b=${cmp[1]}`)}>Comparar</Button>} />
          {data.matches.length === 0 ? <Empty title="Sin partidas" text="Sube la primera partida de este jugador." action={<Link href={`/matches/new?player=${id}`}><Button variant="primary">Nueva partida</Button></Link>} /> : (
            <ul className="divide-y divide-line">
              {data.matches.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <input type="checkbox" aria-label="Comparar" disabled={!m.analysis || (cmp.length >= 2 && !cmp.includes(m.id))} checked={cmp.includes(m.id)}
                    onChange={(e) => setCmp(e.target.checked ? [...cmp, m.id] : cmp.filter((x) => x !== m.id))} className="size-4 accent-[var(--color-brand)]" />
                  <Link href={`/matches/${m.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 hover:text-brand">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{m.title}</div>
                      <div className="text-xs text-ink-3">{m.source_type === "video" ? "Vídeo" : "Replay"} · {fmtDate(m.played_at || m.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <MatchStatusBadge status={m.status} />
                      <span className={cx("tabular w-8 text-right font-semibold", scoreTone(m.analysis?.overall))}>{m.analysis?.overall ?? "—"}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {analysed.length < 2 && data.matches.length > 0 && <div className="border-t border-line px-5 py-3 text-xs text-ink-3">La comparación necesita al menos dos partidas analizadas.</div>}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Objetivos" action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setGoalOpen(true)}>Añadir</Button>} />
            {data.goals.length === 0 ? <Empty title="Sin objetivos" text="Crea objetivos o impórtalos desde un informe." /> : (
              <ul className="divide-y divide-line">
                {data.goals.map((g) => <GoalRow key={g.id} g={g} playerId={id} onChange={reload} />)}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Notas del coach" action={notes === null ? <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setNotes(data.coach_notes || "")}>Editar</Button> : null} />
            <div className="p-5">
              {notes === null ? (
                <p className="whitespace-pre-wrap text-sm text-ink-2">{data.coach_notes || <span className="text-ink-3">Sin notas.</span>}</p>
              ) : (
                <div className="space-y-2">
                  <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNotes(null)}>Cancelar</Button><Button size="sm" variant="primary" loading={savingNotes} onClick={saveNotes}>Guardar</Button></div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={edit} onClose={() => setEdit(false)} title="Editar jugador" wide>
        <PlayerForm initial={data} onSaved={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />
      </Modal>
      <GoalModal open={goalOpen} onClose={() => setGoalOpen(false)} playerId={id} onSaved={() => { setGoalOpen(false); reload(); }} />
    </div>
  );
}

function labelForScoreKey(k: string) {
  return ({ resources: "Recursos", survival: "Supervivencia" } as Record<string, string>)[k] || CATEGORY_LABEL[k as Category] || k;
}

function GoalRow({ g, playerId, onChange }: { g: Goal; playerId: string; onChange: () => void }) {
  const set = async (status: Goal["status"]) => { await patch(`/players/${playerId}/goals/${g.id}`, { status }); onChange(); };
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <button onClick={() => set(g.status === "achieved" ? "pending" : "achieved")} aria-label="Marcar como cumplido"
        className={cx("focus-ring mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border", g.status === "achieved" ? "border-brand bg-brand text-white" : "border-line-strong")}>
        {g.status === "achieved" && <Check className="size-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx("text-sm", g.status !== "pending" && "text-ink-3 line-through")}>{g.title}</div>
        {g.description && <div className="text-xs text-ink-3">{g.description}</div>}
        <div className="mt-1 flex gap-1.5">{g.category && <Badge>{CATEGORY_LABEL[g.category as Category] || g.category}</Badge>}{g.source_analysis_id && <Badge tone="brand">Del informe</Badge>}</div>
      </div>
      <button className="text-ink-3 hover:text-sev-critical" aria-label="Eliminar objetivo" onClick={async () => { await del(`/players/${playerId}/goals/${g.id}`); onChange(); }}><X className="size-4" /></button>
    </li>
  );
}

function GoalModal({ open, onClose, playerId, onSaved }: { open: boolean; onClose: () => void; playerId: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Nuevo objetivo">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await post(`/players/${playerId}/goals`, { title, description: description || null, category: category || null });
        setBusy(false);
        setTitle(""); setDescription(""); setCategory("");
        onSaved();
      }}>
        <Field label="Objetivo"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Rotar antes del segundo cierre" /></Field>
        <Field label="Meta medible"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: 0 daño de tormenta en 3 partidas seguidas" /></Field>
        <Field label="Categoría"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={busy}>Guardar</Button></div>
      </form>
    </Modal>
  );
}
