"use client";

import { Clock, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, patch, post } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { Note } from "@/lib/types";
import { Button, Textarea } from "../ui";

export function NotesPanel({ matchId, notes, currentTime, onSeek, onChanged, timed = true }: {
  matchId: string; notes: Note[]; currentTime: () => number; onSeek: (t: number) => void; onChanged: () => void; timed?: boolean;
}) {
  const [text, setText] = useState("");
  const [atTime, setAtTime] = useState(timed);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        await post(`/matches/${matchId}/notes`, { text, t: atTime ? Math.round(currentTime() * 10) / 10 : null });
        setText(""); setBusy(false); onChanged();
      }}>
        <Textarea rows={2} placeholder="Escribe una nota para el jugador…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center justify-between">
          {timed ? <label className="flex items-center gap-1.5 text-xs text-ink-3"><input type="checkbox" checked={atTime} onChange={(e) => setAtTime(e.target.checked)} className="accent-[var(--color-brand)]" /> En el segundo actual</label> : <span />}
          <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!text.trim()}>Añadir nota</Button>
        </div>
      </form>
      <ul className="divide-y divide-line">
        {notes.length === 0 && <li className="py-4 text-center text-sm text-ink-3">Sin notas todavía.</li>}
        {notes.map((n) => (
          <li key={n.id} className="py-2.5">
            <div className="flex items-start gap-2">
              {n.t != null ? (
                <button onClick={() => onSeek(n.t!)} className="tabular mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-brand hover:bg-brand hover:text-white"><Clock className="size-3" />{fmtTime(n.t)}</button>
              ) : <span className="mt-0.5 shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-ink-3">General</span>}
              {editing === n.id ? (
                <div className="flex-1 space-y-2">
                  <Textarea rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button size="sm" variant="primary" onClick={async () => { await patch(`/notes/${n.id}`, { text: editText, t: n.t, category: n.category }); setEditing(null); onChanged(); }}>Guardar</Button></div>
                </div>
              ) : (
                <>
                  <p className="flex-1 whitespace-pre-wrap text-sm text-ink-2">{n.text}</p>
                  <button className="text-ink-3 hover:text-ink" aria-label="Editar nota" onClick={() => { setEditing(n.id); setEditText(n.text); }}><Pencil className="size-3.5" /></button>
                  <button className="text-ink-3 hover:text-sev-critical" aria-label="Borrar nota" onClick={async () => { await del(`/notes/${n.id}`); onChanged(); }}><Trash2 className="size-3.5" /></button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
