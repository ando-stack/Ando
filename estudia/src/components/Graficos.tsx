// Gráficos ligeros en SVG: mapa de calor por tema, evolución de notas y medidor de nota estimada.
import { motion } from "motion/react";
import type { DominioTema } from "../lib/progreso";

function colorDominio(d: number | null): string {
  if (d === null) return "#e2e8f0";
  // rojo suave → ámbar → verde
  const h = Math.round(5 + d * 135);
  return `hsl(${h} 70% ${d < 0.5 ? 62 : 48}%)`;
}

export function MapaCalor({ dominios }: { dominios: DominioTema[] }) {
  if (!dominios.length) return <p className="text-sm text-slate-500">Aún no hay temas.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {dominios.map((d, i) => (
          <motion.div key={d.topic_id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }} className="rounded-2xl p-3 text-white shadow-sm" style={{ background: colorDominio(d.dominio) }} title={d.dominio === null ? "Sin datos todavía" : `Dominio ${Math.round(d.dominio * 100)} %`}>
            <p className={`line-clamp-2 text-sm font-bold ${d.dominio === null ? "text-slate-600" : ""}`}>{d.titulo}</p>
            <p className={`mt-1 text-2xl font-extrabold tabular-nums ${d.dominio === null ? "text-slate-500" : ""}`}>{d.dominio === null ? "—" : `${Math.round(d.dominio * 100)}%`}</p>
            <p className={`text-[11px] ${d.dominio === null ? "text-slate-500" : "opacity-90"}`}>{d.preguntas} preguntas · {d.tarjetas} tarjetas</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
        <span>Menos</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg, hsl(5 70% 62%), hsl(45 70% 55%), hsl(140 70% 48%))" }} />
        <span>Más dominado</span>
      </div>
    </div>
  );
}

export interface PuntoNota {
  fecha: string;
  nota: number;
  tipo: "test" | "simulacro";
}

export function LineaNotas({ puntos, objetivo }: { puntos: PuntoNota[]; objetivo: number }) {
  if (puntos.length === 0) return <p className="text-sm text-slate-500">Haz tests o exámenes de práctica para ver tu evolución.</p>;
  const W = 600;
  const H = 200;
  const P = 28;
  const ordenados = [...puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const t0 = new Date(ordenados[0].fecha).getTime();
  const t1 = new Date(ordenados[ordenados.length - 1].fecha).getTime();
  const x = (f: string) => (t1 === t0 ? W / 2 : P + ((new Date(f).getTime() - t0) / (t1 - t0)) * (W - 2 * P));
  const y = (n: number) => H - P - (n / 10) * (H - 2 * P);
  const serie = (tipo: PuntoNota["tipo"]) => ordenados.filter((p) => p.tipo === tipo);
  const linea = (ps: PuntoNota[]) => ps.map((p, i) => `${i ? "L" : "M"}${x(p.fecha)},${y(p.nota)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución de tus notas en tests y exámenes de práctica">
      {[0, 5, 10].map((n) => (
        <g key={n}>
          <line x1={P} x2={W - P} y1={y(n)} y2={y(n)} stroke="#e2e8f0" />
          <text x={4} y={y(n) + 4} fontSize={11} fill="#94a3b8">{n}</text>
        </g>
      ))}
      <line x1={P} x2={W - P} y1={y(objetivo)} y2={y(objetivo)} stroke="#a855f7" strokeDasharray="6 5" strokeWidth={1.5} />
      <text x={W - P} y={y(objetivo) - 6} fontSize={11} textAnchor="end" fill="#7c3aed">objetivo {String(objetivo).replace(".", ",")}</text>
      {(["test", "simulacro"] as const).map((tipo) => {
        const ps = serie(tipo);
        const color = tipo === "test" ? "#0ea5e9" : "#db2777";
        return (
          <g key={tipo}>
            {ps.length > 1 && <motion.path d={linea(ps)} fill="none" stroke={color} strokeWidth={2.5} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />}
            {ps.map((p, i) => <circle key={i} cx={x(p.fecha)} cy={y(p.nota)} r={tipo === "simulacro" ? 6 : 4} fill={color} stroke="#fff" strokeWidth={2}><title>{`${tipo === "test" ? "Test" : "Examen de práctica"}: ${p.nota.toFixed(1)}`}</title></circle>)}
          </g>
        );
      })}
      <g fontSize={11}>
        <circle cx={P + 4} cy={12} r={4} fill="#0ea5e9" /><text x={P + 12} y={16} fill="#475569">Tests</text>
        <circle cx={P + 64} cy={12} r={5} fill="#db2777" /><text x={P + 74} y={16} fill="#475569">Exámenes de práctica</text>
      </g>
    </svg>
  );
}

/** Medidor semicircular: nota estimada (con margen) frente al objetivo. */
export function MedidorNota({ nota, margen, objetivo }: { nota: number | null; margen: number; objetivo: number }) {
  const R = 80;
  const cx = 100;
  const cy = 96;
  const ang = (n: number) => Math.PI * (1 - Math.min(10, Math.max(0, n)) / 10);
  const punto = (n: number, r = R) => [cx + r * Math.cos(ang(n)), cy - r * Math.sin(ang(n))];
  const arco = (a: number, b: number, r = R) => {
    const [x1, y1] = punto(a, r);
    const [x2, y2] = punto(b, r);
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`;
  };
  const [ox, oy] = punto(objetivo, R + 12);
  const [ix, iy] = punto(objetivo, R - 12);
  return (
    <svg viewBox="0 0 200 118" className="mx-auto w-full max-w-xs" role="img" aria-label={nota === null ? "Sin estimación todavía" : `Nota estimada ${nota} sobre 10, objetivo ${objetivo}`}>
      <path d={arco(0, 10)} stroke="#ede9fe" strokeWidth={16} fill="none" strokeLinecap="round" />
      {nota !== null && (
        <>
          <path d={arco(Math.max(0, nota - margen), Math.min(10, nota + margen))} stroke="#c4b5fd" strokeWidth={16} fill="none" />
          <motion.path d={arco(0, Math.max(0.05, nota))} stroke="url(#grad-medidor)" strokeWidth={16} fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: "easeOut" }} />
        </>
      )}
      <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="#4c1d95" strokeWidth={3} strokeLinecap="round" />
      <defs>
        <linearGradient id="grad-medidor" x1="0" x2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <text x={cx} y={cy - 14} textAnchor="middle" fontSize={30} fontWeight={800} fill="#0f172a">{nota === null ? "—" : nota.toFixed(1).replace(".", ",")}</text>
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={10} fill="#64748b">{nota === null ? "sin datos aún" : `± ${String(margen).replace(".", ",")} · objetivo ${String(objetivo).replace(".", ",")}`}</text>
    </svg>
  );
}
