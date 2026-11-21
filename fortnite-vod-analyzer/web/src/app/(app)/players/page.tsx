"use client";

import { Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PlayerForm } from "@/components/PlayerForm";
import { Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, cx } from "@/components/ui";
import { fmtRelative, scoreTone } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Player } from "@/lib/types";

export default function PlayersPage() {
  const { data, error, loading, reload } = useApi<Player[]>("/players");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const rows = useMemo(() => (data || []).filter((p) => (p.name + " " + (p.epic_id || "")).toLowerCase().includes(q.toLowerCase())), [data, q]);

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Plantilla" title="Jugadores" subtitle="Perfiles, historial y evolución de cada jugador" actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>Nuevo jugador</Button>} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? <Loading /> : (
        <Card>
          {data && data.length > 0 && (
            <div className="border-b border-line p-3">
              <div className="relative max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                <Input placeholder="Buscar jugador" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
              </div>
            </div>
          )}
          {rows.length === 0 ? (
            <Empty icon={<Users className="size-5" />} title={data?.length ? "Sin resultados" : "Todavía no hay jugadores"} text={data?.length ? undefined : "Crea el primer perfil para empezar a subir partidas."}
              action={!data?.length && <Button variant="primary" onClick={() => setOpen(true)}>Crear jugador</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-5 py-3 font-medium">Jugador</th><th className="px-3 py-3 font-medium">Plataforma</th><th className="px-3 py-3 font-medium">Región</th>
                    <th className="px-3 py-3 font-medium">Modo</th><th className="px-3 py-3 font-medium">Nivel</th><th className="px-3 py-3 text-right font-medium">Partidas</th>
                    <th className="px-5 py-3 text-right font-medium">Última nota</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/players/${p.id}`)}>
                      <td className="px-5 py-3">
                        <Link href={`/players/${p.id}`} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                          <span className="grid size-8 place-items-center rounded-lg bg-surface-3 text-xs font-semibold text-ink-2">{p.name.slice(0, 2).toUpperCase()}</span>
                          <span><span className="block font-medium">{p.name}</span>{p.epic_id && <span className="block text-xs text-ink-3">{p.epic_id}</span>}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-ink-2">{p.platform || "—"}</td>
                      <td className="px-3 py-3 text-ink-2">{p.region || "—"}</td>
                      <td className="px-3 py-3 text-ink-2">{p.game_mode || "—"}</td>
                      <td className="px-3 py-3 text-ink-2">{p.competitive_level || "—"}</td>
                      <td className="tabular px-3 py-3 text-right">{p.matches}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={cx("tabular font-semibold", scoreTone(p.last_score))}>{p.last_score ?? "—"}</span>
                        {p.last_analysis_at && <span className="block text-xs text-ink-3">{fmtRelative(p.last_analysis_at)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo jugador" wide>
        <PlayerForm onSaved={(p) => { setOpen(false); router.push(`/players/${p.id}`); }} onCancel={() => setOpen(false)} />
      </Modal>
    </div>
  );
}
