"use client";

import { RotateCcw, ScanText } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Loading, PageHeader, Select, cx } from "@/components/ui";
import { apiRaw, del, post } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Match } from "@/lib/types";

type Rect = [number, number, number, number];
interface Layout { name: string; calibrated: boolean; rects: Record<string, Rect> }

const COLORS = ["#2e7dff", "#2fbf71", "#e3b23c", "#f0803c", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"];

export default function HudCalibrationPage() {
  const { id } = useParams<{ id: string }>();
  const meta = useApi<any>("/hud/fields");
  const saved = useApi<Layout>(`/players/${id}/hud`);
  const matches = useApi<Match[]>(`/matches?player_id=${id}`);
  const videos = (matches.data || []).filter((m) => m.source_type === "video" && m.status !== "draft");
  const [matchId, setMatchId] = useState("");
  const [t, setT] = useState(60);
  const [img, setImg] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [active, setActive] = useState<string>("health");
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [test, setTest] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (saved.data && !layout) setLayout(saved.data); }, [saved.data, layout]);
  useEffect(() => { if (!matchId && videos[0]) setMatchId(videos[0].id); }, [videos, matchId]);
  useEffect(() => {
    if (!matchId) return;
    let url: string | null = null;
    setImgErr(null);
    apiRaw(`/matches/${matchId}/snapshot?t=${t}`).then((r) => r.blob()).then((b) => { url = URL.createObjectURL(b); setImg(url); }).catch((e) => setImgErr(e.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [matchId, t]);

  if (meta.loading || saved.loading || matches.loading) return <Loading />;
  if (!layout || !meta.data) return saved.error ? <ErrorBox message={saved.error} /> : <Loading />;
  const fields = Object.keys(meta.data.fields);

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const setRect = (k: string, rc: Rect | null) => {
    const rects = { ...layout.rects };
    if (rc) rects[k] = rc; else delete rects[k];
    setLayout({ ...layout, rects });
    setTest(null);
  };

  return (
    <div className="fade-in">
      <PageHeader eyebrow="Calibración del HUD" title="Zonas del HUD del jugador"
        subtitle="Cada jugador coloca el HUD a su manera. Marca dónde aparece cada número para que la lectura automática sea fiable."
        actions={<>
          <Link href={`/players/${id}`}><Button variant="ghost">Volver al jugador</Button></Link>
          <Button icon={<RotateCcw className="size-4" />} onClick={async () => { const l = await del<Layout>(`/players/${id}/hud`); setLayout(l); setTest(null); setMsg("Restablecido al preset aproximado"); }}>Restablecer</Button>
          <Button variant="primary" loading={busy === "save"} onClick={async () => {
            setBusy("save"); setMsg(null);
            try { const l = await api_put(`/players/${id}/hud`, { name: "Calibrado por el coach", rects: layout.rects, calibrated: true }); setLayout(l); setMsg("Calibración guardada. Se usará en los próximos análisis de este jugador."); }
            catch (e: any) { setMsg(e.message); } finally { setBusy(null); }
          }}>Guardar calibración</Button>
        </>} />
      {msg && <div className="mb-4 rounded-lg border border-[#1d3766] bg-brand-soft px-4 py-2 text-sm">{msg}</div>}
      {!meta.data.ocr.available && <div className="mb-4"><ErrorBox message={meta.data.ocr.detail} /></div>}

      {videos.length === 0 ? (
        <Card><Empty icon={<ScanText className="size-5" />} title="Necesitas un vídeo de este jugador" text="Sube una partida en vídeo para poder marcar las zonas del HUD sobre un fotograma real." action={<Link href={`/matches/new?player=${id}`}><Button variant="primary">Subir partida</Button></Link>} /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
              <Field label="Partida"><Select value={matchId} onChange={(e) => setMatchId(e.target.value)} className="min-w-56">{videos.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select></Field>
              <Field label={`Segundo (${fmtTime(t)})`}><Input type="number" min={0} step={5} value={t} onChange={(e) => setT(Math.max(0, Number(e.target.value) || 0))} className="w-28" /></Field>
              <p className="pb-2 text-xs text-ink-3">Elige un momento en partida con el HUD visible. Selecciona un campo a la derecha y arrastra sobre la imagen para marcar su número.</p>
            </div>
            {imgErr && <div className="p-4"><ErrorBox message={imgErr} /></div>}
            <div ref={box} className="relative cursor-crosshair select-none bg-black"
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(pos(e)); }}
              onPointerMove={(e) => { if (!drag) return; const p = pos(e); setRect(active, [Math.min(drag.x, p.x), Math.min(drag.y, p.y), Math.max(drag.x, p.x), Math.max(drag.y, p.y)]); }}
              onPointerUp={() => { setDrag(null); const i = fields.indexOf(active); const next = fields.slice(i + 1).find((f) => !layout.rects[f]); if (next) setActive(next); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {img ? <img src={img} alt="Fotograma de la partida" className="block w-full" draggable={false} /> : <div className="grid aspect-video place-items-center text-sm text-ink-3">Cargando fotograma…</div>}
              {Object.entries(layout.rects).map(([k, [x0, y0, x1, y1]]) => {
                const c = COLORS[fields.indexOf(k) % COLORS.length];
                return (
                  <div key={k} className={cx("pointer-events-none absolute border-2", k === active && "ring-2 ring-white/60")} style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%`, borderColor: c, background: `${c}22` }}>
                    {k === active && <span className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-semibold text-black" style={{ background: c }}>{meta.data.fields[k].label}</span>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="h-fit">
            <CardHeader title="Campos" subtitle={layout.calibrated ? "Calibrado" : "Preset aproximado (sin calibrar)"} action={layout.calibrated ? <Badge tone="ok">Calibrado</Badge> : <Badge tone="warn">Sin calibrar</Badge>} />
            <ul className="divide-y divide-line">
              {fields.map((k, i) => {
                const r = test?.fields?.[k];
                return (
                  <li key={k}>
                    <button onClick={() => setActive(k)} className={cx("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", active === k ? "bg-brand-soft" : "hover:bg-surface-2")}>
                      <span className="size-3 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length], opacity: layout.rects[k] ? 1 : 0.25 }} />
                      <span className="flex-1">{meta.data.fields[k].label}</span>
                      {r && (r.value != null ? <span className="tabular font-mono text-xs text-ok">{k === "storm_timer" ? fmtTime(r.value) : r.value}</span> : <span className="text-xs text-sev-critical" title={`Texto leído: ${r.text || "—"}`}>sin lectura</span>)}
                      {layout.rects[k] && <span role="button" tabIndex={0} className="text-xs text-ink-3 hover:text-sev-critical" onClick={(e) => { e.stopPropagation(); setRect(k, null); }}>quitar</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2 border-t border-line p-4">
              <Button className="w-full" icon={<ScanText className="size-4" />} loading={busy === "test"} disabled={!matchId} onClick={async () => {
                setBusy("test"); setMsg(null);
                try { setTest(await post(`/hud/test`, { match_id: matchId, t, layout: { name: layout.name, rects: layout.rects, calibrated: true } })); }
                catch (e: any) { setMsg(e.message); } finally { setBusy(null); }
              }}>Probar lectura en este fotograma</Button>
              {test && <p className="text-xs text-ink-3">Tinte de tormenta en el borde: {Math.round(test.storm_fraction * 100)} % (≥ 35 % cuenta como "dentro de la tormenta").</p>}
              <p className="text-xs text-ink-3">Consejo: ajusta cada caja solo al número, sin iconos. Prueba en 2–3 momentos distintos (con escudo 0, con muchos materiales…).</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

async function api_put(path: string, body: unknown) {
  const r = await apiRaw(path, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return r.json();
}
