"use client";

import { Bot, CheckCircle2, CircleSlash, Plus, Trash2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { del, patch, post } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL, ERROR_TYPE_LABEL, PHASE_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER, fmtTime } from "@/lib/format";
import type { Category, ErrorType, Finding, Severity } from "@/lib/types";
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, SeverityBadge, Textarea, cx } from "../ui";

export interface Filters { cats: Set<Category>; sevs: Set<Severity>; origin: "all" | "ai" | "rules" | "coach"; showDismissed: boolean }
export const defaultFilters = (): Filters => ({ cats: new Set(), sevs: new Set(), origin: "all", showDismissed: false });

export function applyFilters(fs: Finding[], f: Filters) {
  return fs.filter((x) =>
    (f.cats.size === 0 || f.cats.has(x.category)) && (f.sevs.size === 0 || f.sevs.has(x.severity)) &&
    (f.origin === "all" || x.origin === f.origin) && (f.showDismissed || x.review_status !== "dismissed"));
}

export function FilterBar({ findings, filters, onChange }: { findings: Finding[]; filters: Filters; onChange: (f: Filters) => void }) {
  const present = useMemo(() => CATEGORIES.filter((c) => findings.some((f) => f.category === c)), [findings]);
  const toggle = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {present.map((c) => (
          <button key={c} onClick={() => onChange({ ...filters, cats: toggle(filters.cats, c) })}
            className={cx("focus-ring rounded-md border px-2 py-1 text-xs font-medium transition-colors", filters.cats.has(c) ? "border-brand bg-brand-soft text-ink" : "border-line text-ink-3 hover:text-ink-2")}>
            {CATEGORY_LABEL[c]} <span className="tabular text-ink-3">{findings.filter((f) => f.category === c && (filters.showDismissed || f.review_status !== "dismissed")).length}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITY_ORDER.map((s) => (
          <button key={s} onClick={() => onChange({ ...filters, sevs: toggle(filters.sevs, s) })}
            className={cx("focus-ring inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium", filters.sevs.has(s) ? "border-brand bg-brand-soft text-ink" : "border-line text-ink-3 hover:text-ink-2")}>
            <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />{SEVERITY_LABEL[s]}
          </button>
        ))}
        <select value={filters.origin} onChange={(e) => onChange({ ...filters, origin: e.target.value as Filters["origin"] })} className="focus-ring h-7 rounded-md border border-line bg-surface-2 px-2 text-xs text-ink-2" aria-label="Origen">
          <option value="all">Todos los orígenes</option><option value="rules">Solo reglas</option><option value="ai">Solo IA</option><option value="coach">Solo coach</option>
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-3"><input type="checkbox" checked={filters.showDismissed} onChange={(e) => onChange({ ...filters, showDismissed: e.target.checked })} className="accent-[var(--color-brand)]" />Descartados</label>
      </div>
    </div>
  );
}

export function FindingsList({ findings, selectedId, onPick }: { findings: Finding[]; selectedId: string | null; onPick: (f: Finding) => void }) {
  if (!findings.length) return <div className="py-10 text-center text-sm text-ink-3">No hay errores con estos filtros.</div>;
  return (
    <ul className="divide-y divide-line">
      {findings.map((f) => (
        <li key={f.id}>
          <button onClick={() => onPick(f)} className={cx("focus-ring flex w-full gap-3 px-4 py-3 text-left transition-colors", selectedId === f.id ? "bg-brand-soft" : "hover:bg-surface-2", f.review_status === "dismissed" && "opacity-50")}>
            <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[f.severity] }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="tabular font-mono text-xs font-medium text-brand">{fmtTime(f.t_start)}</span>
                <span className="truncate text-sm font-medium">{f.title}</span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                {CATEGORY_LABEL[f.category]}{f.error_type && ` · ${ERROR_TYPE_LABEL[f.error_type]}`}{f.phase && ` · ${PHASE_LABEL[f.phase]}`}
                {f.origin === "coach" && <Badge tone="brand"><UserRound className="size-3" />Coach</Badge>}
                {f.origin === "rules" && <Badge>Regla</Badge>}
                {f.review_status === "confirmed" && f.origin !== "coach" && <Badge tone="ok">Confirmado</Badge>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FindingDetail({ f, frameUrl, onSeek, onChanged }: { f: Finding; frameUrl: ((label: string) => string) | null; onSeek: (t: number) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const set = async (body: Record<string, unknown>, key: string) => { setBusy(key); try { await patch(`/findings/${f.id}`, body); onChanged(); } finally { setBusy(null); } };
  const frames = f.evidence.filter((e) => e.kind === "frame");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <button className="tabular rounded-md bg-brand-soft px-1.5 py-0.5 font-mono font-medium text-brand hover:bg-brand hover:text-white" onClick={() => onSeek(f.t_start)}>
              {fmtTime(f.t_start, true)}{f.t_end ? ` – ${fmtTime(f.t_end, true)}` : ""}
            </button>
            <SeverityBadge s={f.severity} />
            <Badge>{CATEGORY_LABEL[f.category]}</Badge>
            {f.error_type && <Badge>{ERROR_TYPE_LABEL[f.error_type]}</Badge>}
            {f.phase && <Badge>{PHASE_LABEL[f.phase]}</Badge>}
            {f.origin === "coach" ? <Badge tone="brand"><UserRound className="size-3" />Coach</Badge> : <Badge><Bot className="size-3" />{f.origin === "rules" ? "Regla automática" : "IA"} · confianza {Math.round((f.confidence || 0) * 100)}%</Badge>}
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{f.title}</h3>
        </div>
        <div className="flex gap-1.5">
          {f.origin !== "coach" && f.review_status !== "confirmed" && <Button size="sm" icon={<CheckCircle2 className="size-3.5" />} loading={busy === "c"} onClick={() => set({ review_status: "confirmed" }, "c")}>Confirmar</Button>}
          {f.origin !== "coach" && f.review_status !== "dismissed" && <Button size="sm" variant="ghost" icon={<CircleSlash className="size-3.5" />} loading={busy === "d"} onClick={() => set({ review_status: "dismissed" }, "d")}>Descartar</Button>}
          {f.origin !== "coach" && f.review_status === "dismissed" && <Button size="sm" variant="ghost" loading={busy === "r"} onClick={() => set({ review_status: "open" }, "r")}>Restaurar</Button>}
          {f.origin === "coach" && <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={async () => { await del(`/findings/${f.id}`); onChanged(); }}>Borrar</Button>}
          <Select className="h-8 w-auto text-xs" value={f.severity} onChange={(e) => set({ severity: e.target.value }, "s")} aria-label="Cambiar gravedad">
            {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
          </Select>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Block label="Qué ha sucedido" text={f.what_happened} />
        <Block label="Por qué es un error" text={f.why_error} />
        <Block label="Qué debería haber hecho" text={f.what_to_do} />
        <Block label="Cómo evitar repetirlo" text={f.how_to_avoid} />
      </dl>
      {frames.length > 0 && frameUrl && (
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">Evidencia ({frames.length} fotogramas)</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frames.map((e) => (
              <button key={e.id} onClick={() => onSeek(e.t)} className="focus-ring group shrink-0 overflow-hidden rounded-lg border border-line hover:border-brand" title={`Ir a ${fmtTime(e.t, true)}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frameUrl(e.id)} alt={`Fotograma ${e.id} en ${fmtTime(e.t, true)}`} className="h-24 w-auto bg-surface-3" loading="lazy" />
                <div className="tabular bg-surface-2 px-2 py-1 text-left font-mono text-[11px] text-ink-3 group-hover:text-ink">{e.id} · {fmtTime(e.t, true)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {f.evidence.some((e) => e.kind === "replay_event") && (
        <div className="text-xs text-ink-3">Evidencia: eventos de replay {f.evidence.map((e) => `${e.id} (${fmtTime(e.t)})`).join(", ")}</div>
      )}
    </div>
  );
}

function Block({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-ink">{text || <span className="text-ink-3">—</span>}</dd>
    </div>
  );
}

export function AddFindingModal({ open, onClose, matchId, t, onSaved }: { open: boolean; onClose: () => void; matchId: string; t: number; onSaved: () => void }) {
  const [f, setF] = useState({ category: "positioning", error_type: "positioning", severity: "medium", title: "", what_happened: "", why_error: "", what_to_do: "", how_to_avoid: "" });
  const [time, setTime] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tt = time ?? t;
  const s = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={() => { setTime(null); onClose(); }} title={`Nuevo marcador en ${fmtTime(tt, true)}`} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          await post(`/matches/${matchId}/findings`, { ...f, t_start: tt, why_error: f.why_error || null, what_to_do: f.what_to_do || null, how_to_avoid: f.how_to_avoid || null });
          setF({ ...f, title: "", what_happened: "", why_error: "", what_to_do: "", how_to_avoid: "" }); setTime(null); onSaved();
        } catch (err: any) { setError(err.message); } finally { setBusy(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Segundo"><Input type="number" step="0.1" min={0} value={tt.toFixed(1)} onChange={(e) => setTime(parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Categoría"><Select value={f.category} onChange={s("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
          <Field label="Tipo"><Select value={f.error_type} onChange={s("error_type")}>{(Object.keys(ERROR_TYPE_LABEL) as ErrorType[]).map((c) => <option key={c} value={c}>{ERROR_TYPE_LABEL[c]}</option>)}</Select></Field>
          <Field label="Gravedad"><Select value={f.severity} onChange={s("severity")}>{SEVERITY_ORDER.map((c) => <option key={c} value={c}>{SEVERITY_LABEL[c]}</option>)}</Select></Field>
        </div>
        <Field label="Título *"><Input required value={f.title} onChange={s("title")} maxLength={200} /></Field>
        <Field label="Qué ha sucedido *"><Textarea required rows={2} value={f.what_happened} onChange={s("what_happened")} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Por qué es un error"><Textarea rows={2} value={f.why_error} onChange={s("why_error")} /></Field>
          <Field label="Qué debió hacer"><Textarea rows={2} value={f.what_to_do} onChange={s("what_to_do")} /></Field>
          <Field label="Cómo evitarlo"><Textarea rows={2} value={f.how_to_avoid} onChange={s("how_to_avoid")} /></Field>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={busy} icon={<Plus className="size-4" />}>Añadir marcador</Button></div>
      </form>
    </Modal>
  );
}
