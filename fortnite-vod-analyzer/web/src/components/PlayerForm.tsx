"use client";

import { useState } from "react";
import { patch, post } from "@/lib/api";
import type { Player } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Select, Textarea } from "./ui";

export const PLATFORMS = ["PC", "PlayStation", "Xbox", "Switch", "Mobile"];
export const REGIONS = ["EU", "NA-East", "NA-Central", "NA-West", "Brasil", "Asia", "Oceanía", "Middle East"];
export const MODES = ["Solo", "Dúos", "Tríos", "Squads", "Zero Build Solo", "Zero Build Dúos", "Ranked Solo", "Ranked Dúos", "FNCS", "Cash Cup", "Creativo"];
export const LEVELS = ["Principiante", "Intermedio", "Avanzado", "Semi-pro", "Profesional"];

export function PlayerForm({ initial, onSaved, onCancel }: { initial?: Player; onSaved: (p: Player) => void; onCancel?: () => void }) {
  const [f, setF] = useState({
    name: initial?.name || "", epic_id: initial?.epic_id || "", platform: initial?.platform || "", region: initial?.region || "",
    game_mode: initial?.game_mode || "", competitive_level: initial?.competitive_level || "", coach_notes: initial?.coach_notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    try {
      const p = initial ? await patch<Player>(`/players/${initial.id}`, body) : await post<Player>("/players", body);
      onSaved(p);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre *"><Input required value={f.name} onChange={set("name")} maxLength={120} /></Field>
        <Field label="Epic Games ID" hint="Opcional"><Input value={f.epic_id} onChange={set("epic_id")} maxLength={120} /></Field>
        <Field label="Plataforma"><Select value={f.platform} onChange={set("platform")}><option value="">—</option>{PLATFORMS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Región"><Select value={f.region} onChange={set("region")}><option value="">—</option>{REGIONS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Modo de juego"><Select value={f.game_mode} onChange={set("game_mode")}><option value="">—</option>{MODES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Nivel competitivo"><Select value={f.competitive_level} onChange={set("competitive_level")}><option value="">—</option>{LEVELS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
      </div>
      <Field label="Notas del coach"><Textarea rows={3} value={f.coach_notes} onChange={set("coach_notes")} /></Field>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" loading={busy}>{initial ? "Guardar cambios" : "Crear jugador"}</Button>
      </div>
    </form>
  );
}
