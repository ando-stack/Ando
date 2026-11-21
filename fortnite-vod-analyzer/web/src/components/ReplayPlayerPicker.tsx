"use client";

import { AlertTriangle, Crown } from "lucide-react";
import { useEffect, useState } from "react";
import { api, patch } from "@/lib/api";
import { Badge, Button, ErrorBox, Loading, cx } from "./ui";

export function ReplayPlayerPicker({ matchId, value, onPicked }: { matchId: string; value: string | null; onPicked: (ref: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/matches/${matchId}/replay/players`).then((d) => {
      setData(d);
      if (!value && d.owner_ref) setSel(d.owner_ref);
    }).catch((e) => setError(e.message));
  }, [matchId, value]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading label="Leyendo la replay…" />;
  if (!data.compatible) {
    return (
      <div className="rounded-xl border border-[#4a2327] bg-[#1a0d0f] p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-[#ffb3b6]"><AlertTriangle className="size-4" /> Replay no compatible</div>
        <p className="mt-1 text-ink-2">{data.error}</p>
        <p className="mt-2 text-ink-3">Alternativa: abre la replay en el <b>Modo Repetición</b> de Fortnite, grábala (OBS, Nvidia ShadowPlay, Xbox Game Bar…) y sube el vídeo a esta misma partida.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge>Fortnite {data.version.season || data.version.branch}</Badge>
        <Badge>Duración {Math.round(data.length_s / 60)} min</Badge>
        <Badge tone="brand">{data.adapter}</Badge>
        {data.unavailable.length > 0 && <Badge tone="warn">No disponible: {data.unavailable.join(", ")}</Badge>}
      </div>
      {data.warnings.length > 0 && <ul className="space-y-1 text-xs text-ink-3">{data.warnings.map((w: string) => <li key={w}>· {w}</li>)}</ul>}
      <div className="max-h-80 overflow-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
            <tr><th className="px-4 py-2 font-medium">Jugador</th><th className="px-3 py-2 text-right font-medium">Elims</th><th className="px-3 py-2 text-right font-medium">Knocks</th><th className="px-4 py-2 text-right font-medium">Puesto</th></tr>
          </thead>
          <tbody>
            {data.players.map((p: any) => (
              <tr key={p.ref} onClick={() => setSel(p.ref)} className={cx("cursor-pointer border-t border-line", sel === p.ref ? "bg-brand-soft" : "hover:bg-surface-2")}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <input type="radio" checked={sel === p.ref} onChange={() => setSel(p.ref)} className="accent-[var(--color-brand)]" aria-label={p.name || p.ref} />
                    <span className="truncate">{p.name || <span className="font-mono text-xs text-ink-3">{p.ref.slice(0, 12)}…</span>}</span>
                    {p.is_owner && <Badge tone="brand"><Crown className="size-3" /> Grabó la replay</Badge>}
                  </div>
                </td>
                <td className="tabular px-3 py-2 text-right">{p.elims}</td>
                <td className="tabular px-3 py-2 text-right">{p.knocks}</td>
                <td className="tabular px-4 py-2 text-right">{p.placement ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.players.some((p: any) => p.name) && <p className="text-xs text-ink-3">Los nombres no están disponibles con el lector de eventos (solo IDs de cuenta). Configura el adaptador FRD en el backend para ver nombres y posiciones.</p>}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!sel} loading={busy} onClick={async () => { setBusy(true); await patch(`/matches/${matchId}`, { target_player_ref: sel }); setBusy(false); onPicked(sel!); }}>
          Analizar a este jugador
        </Button>
      </div>
    </div>
  );
}
