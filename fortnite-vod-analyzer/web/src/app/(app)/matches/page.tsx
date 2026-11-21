"use client";

import { Film, FileArchive } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MatchStatusBadge } from "@/components/MatchStatusBadge";
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Select, cx } from "@/components/ui";
import { STATUS_LABEL, fmtDate, scoreTone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Match, Player } from "@/lib/types";

export default function MatchesPage() {
  const [player, setPlayer] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<Match[]>(`/matches${player ? `?player_id=${player}` : ""}`, [player]);
  const players = useApi<Player[]>("/players");
  const rows = (data || []).filter((m) => !status || m.status === status);

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Historial" title="Partidas" actions={<Link href="/matches/new"><Button variant="primary">Nueva partida</Button></Link>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-auto min-w-44" value={player} onChange={(e) => setPlayer(e.target.value)} aria-label="Filtrar por jugador">
          <option value="">Todos los jugadores</option>
          {players.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="w-auto min-w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : (
        <Card>
          {rows.length === 0 ? <Empty icon={<Film className="size-5" />} title="No hay partidas" action={<Link href="/matches/new"><Button variant="primary">Subir partida</Button></Link>} /> : (
            <ul className="divide-y divide-line">
              {rows.map((m) => (
                <li key={m.id}>
                  <Link href={`/matches/${m.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-ink-3">
                      {m.source_type === "video" ? <Film className="size-4" /> : <FileArchive className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.title}</div>
                      <div className="text-xs text-ink-3">{m.player_name} · {m.game_mode || "—"} · {fmtDate(m.played_at || m.created_at)}</div>
                    </div>
                    <MatchStatusBadge status={m.status} />
                    <span className={cx("tabular w-10 text-right text-lg font-semibold", scoreTone(m.analysis?.overall))}>{m.analysis?.overall ?? "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
