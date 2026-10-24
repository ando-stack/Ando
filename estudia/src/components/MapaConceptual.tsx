// Mapa conceptual interactivo: los nodos se despliegan con animación. Exportable a PNG y PDF.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Fuente, NodoMapa } from "../lib/tipos";
import { Citas } from "./ui";

const ANCHO = 210;
const SEP_X = 70;
const SEP_Y = 16;
const LINEA = 17;
const CARACTERES = 26;
const PALETA = ["#7c3aed", "#db2777", "#0891b2", "#059669", "#d97706", "#2563eb", "#dc2626"];

function textoPlano(t: string) {
  return t.replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/[*_`#>]/g, "").replace(/\\(frac|cdot|times|sqrt)/g, (m) => ({ "\\frac": "/", "\\cdot": "·", "\\times": "×", "\\sqrt": "√" })[m] ?? m).trim();
}

export function partirLineas(texto: string, max = CARACTERES): string[] {
  const palabras = textoPlano(texto).split(/\s+/);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    if ((actual + " " + p).trim().length > max && actual) {
      lineas.push(actual);
      actual = p;
    } else actual = (actual + " " + p).trim();
  }
  if (actual) lineas.push(actual);
  return lineas.slice(0, 5);
}

interface Colocado {
  nodo: NodoMapa;
  x: number;
  y: number;
  alto: number;
  lineas: string[];
  color: string;
  padre: Colocado | null;
  ocultos: number;
  profundidad: number;
}

export function colocar(raiz: NodoMapa, abiertos: Set<string>): { nodos: Colocado[]; ancho: number; alto: number } {
  const nodos: Colocado[] = [];
  const altoNodo = (n: NodoMapa) => partirLineas(n.texto).length * LINEA + 18;
  const altoSub = new Map<string, number>();
  const medir = (n: NodoMapa): number => {
    const hijos = abiertos.has(n.id) ? n.hijos : [];
    const h = hijos.length ? Math.max(altoNodo(n), hijos.reduce((a, c) => a + medir(c), 0) + SEP_Y * (hijos.length - 1)) : altoNodo(n);
    altoSub.set(n.id, h);
    return h;
  };
  const total = medir(raiz);
  const situar = (n: NodoMapa, prof: number, y0: number, padre: Colocado | null, color: string) => {
    const h = altoSub.get(n.id)!;
    const alto = altoNodo(n);
    const c: Colocado = { nodo: n, x: prof * (ANCHO + SEP_X), y: y0 + h / 2 - alto / 2, alto, lineas: partirLineas(n.texto), color, padre, ocultos: abiertos.has(n.id) ? 0 : n.hijos.length, profundidad: prof };
    nodos.push(c);
    if (abiertos.has(n.id)) {
      let y = y0 + (h - (n.hijos.reduce((a, x) => a + altoSub.get(x.id)!, 0) + SEP_Y * (n.hijos.length - 1))) / 2;
      n.hijos.forEach((hijo, i) => {
        situar(hijo, prof + 1, y, c, prof === 0 ? PALETA[i % PALETA.length] : color);
        y += altoSub.get(hijo.id)! + SEP_Y;
      });
    }
  };
  situar(raiz, 0, 0, null, "#4c1d95");
  const ancho = Math.max(...nodos.map((n) => n.x)) + ANCHO;
  return { nodos, ancho, alto: total };
}

function camino(a: Colocado, b: Colocado) {
  const x1 = a.x + ANCHO;
  const y1 = a.y + a.alto / 2;
  const x2 = b.x;
  const y2 = b.y + b.alto / 2;
  const m = (x1 + x2) / 2;
  return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** SVG estático (para exportar). */
export function svgEstatico(raiz: NodoMapa, abiertos: Set<string>, titulo: string): { svg: string; ancho: number; alto: number } {
  const { nodos, ancho, alto } = colocar(raiz, abiertos);
  const M = 30;
  const W = ancho + 2 * M;
  const H = alto + 2 * M + 40;
  const partes: string[] = [];
  partes.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  partes.push(`<text x="${M}" y="${M + 8}" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#1e1b4b">${esc(titulo)}</text>`);
  partes.push(`<g transform="translate(${M},${M + 30})">`);
  for (const n of nodos) if (n.padre) partes.push(`<path d="${camino(n.padre, n)}" fill="none" stroke="${n.color}" stroke-opacity="0.45" stroke-width="2.5"/>`);
  for (const n of nodos) {
    const raizN = !n.padre;
    partes.push(`<rect x="${n.x}" y="${n.y}" width="${ANCHO}" height="${n.alto}" rx="14" fill="${raizN ? n.color : "#ffffff"}" stroke="${n.color}" stroke-width="2"/>`);
    n.lineas.forEach((l, i) => partes.push(`<text x="${n.x + 12}" y="${n.y + 22 + i * LINEA}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="${raizN ? 700 : 500}" fill="${raizN ? "#ffffff" : "#1e293b"}">${esc(l)}</text>`));
    if (n.nodo.ampliacion) partes.push(`<text x="${n.x + ANCHO - 18}" y="${n.y + 16}" font-size="11">⚠</text>`);
  }
  partes.push("</g>");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${partes.join("")}</svg>`, ancho: W, alto: H };
}

async function svgACanvas(svg: string, ancho: number, alto: number, escala = 2): Promise<HTMLCanvasElement> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise<void>((ok, mal) => {
    img.onload = () => ok();
    img.onerror = () => mal(new Error("No se pudo dibujar el mapa"));
    img.src = url;
  });
  const c = document.createElement("canvas");
  c.width = ancho * escala;
  c.height = alto * escala;
  const ctx = c.getContext("2d")!;
  ctx.scale(escala, escala);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return c;
}

export async function exportarMapa(raiz: NodoMapa, abiertos: Set<string>, titulo: string, formato: "png" | "pdf") {
  const { svg, ancho, alto } = svgEstatico(raiz, abiertos, titulo);
  const canvas = await svgACanvas(svg, ancho, alto);
  const nombre = titulo.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase().slice(0, 60) || "mapa";
  if (formato === "png") {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${nombre}.png`;
    a.click();
    return;
  }
  const { jsPDF } = await import("jspdf");
  const horizontal = ancho >= alto;
  const pdf = new jsPDF({ orientation: horizontal ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth() - 40;
  const ph = pdf.internal.pageSize.getHeight() - 40;
  const k = Math.min(pw / ancho, ph / alto);
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 20, 20, ancho * k, alto * k);
  pdf.save(`${nombre}.pdf`);
}

export function todosLosIds(n: NodoMapa, out = new Set<string>()): Set<string> {
  out.add(n.id);
  n.hijos.forEach((h) => todosLosIds(h, out));
  return out;
}

export function MapaConceptual({ raiz, abiertos, alAlternar, alVerFuente }: { raiz: NodoMapa; abiertos: Set<string>; alAlternar: (id: string) => void; alVerFuente: (f: Fuente) => void }) {
  const { nodos, ancho, alto } = useMemo(() => colocar(raiz, abiertos), [raiz, abiertos]);
  const [zoom, setZoom] = useState(1);
  const [seleccion, setSeleccion] = useState<NodoMapa | null>(null);
  const cont = useRef<HTMLDivElement>(null);
  const M = 20;
  const anchoTotal = ancho + 2 * M;

  // Al abrir o desplegar, ajustar el zoom para que quepa a lo ancho (pantallas pequeñas)
  useEffect(() => {
    const disponible = cont.current?.clientWidth ?? anchoTotal;
    setZoom(Math.max(0.45, Math.min(1, disponible / anchoTotal)));
  }, [anchoTotal]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1">
        <button type="button" className="chip bg-white ring-1 ring-slate-200" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} aria-label="Alejar">−</button>
        <span className="w-12 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
        <button type="button" className="chip bg-white ring-1 ring-slate-200" onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))} aria-label="Acercar">+</button>
      </div>
      <div ref={cont} className="overflow-auto rounded-3xl bg-gradient-to-br from-white to-marca-50/50 ring-1 ring-marca-100" style={{ maxHeight: "70vh" }}>
        <svg width={(ancho + 2 * M) * zoom} height={(alto + 2 * M) * zoom} viewBox={`0 0 ${ancho + 2 * M} ${alto + 2 * M}`} role="tree" aria-label="Mapa conceptual">
          <g transform={`translate(${M},${M})`}>
            <AnimatePresence>
              {nodos.filter((n) => n.padre).map((n) => (
                <motion.path key={`l-${n.nodo.id}`} d={camino(n.padre!, n)} fill="none" stroke={n.color} strokeOpacity={0.45} strokeWidth={2.5} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1, d: camino(n.padre!, n) }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
              ))}
            </AnimatePresence>
            <AnimatePresence>
              {nodos.map((n) => {
                const raizN = !n.padre;
                const sel = seleccion?.id === n.nodo.id;
                return (
                  <motion.g
                    key={n.nodo.id}
                    role="treeitem"
                    aria-expanded={n.nodo.hijos.length ? abiertos.has(n.nodo.id) : undefined}
                    tabIndex={0}
                    initial={{ opacity: 0, x: n.padre ? n.padre.x : n.x, y: n.padre ? n.padre.y : n.y, scale: 0.8 }}
                    animate={{ opacity: 1, x: n.x, y: n.y, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSeleccion(n.nodo);
                      if (n.nodo.hijos.length) alAlternar(n.nodo.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSeleccion(n.nodo);
                        if (n.nodo.hijos.length) alAlternar(n.nodo.id);
                      }
                    }}
                  >
                    <rect width={ANCHO} height={n.alto} rx={14} fill={raizN ? n.color : n.nodo.ampliacion ? "#fffbeb" : "#ffffff"} stroke={n.color} strokeWidth={sel ? 3.5 : 2} />
                    {n.lineas.map((l, i) => (
                      <text key={i} x={12} y={22 + i * LINEA} fontSize={13} fontWeight={raizN ? 700 : 500} fill={raizN ? "#fff" : "#1e293b"}>
                        {l}
                      </text>
                    ))}
                    {n.ocultos > 0 && (
                      <g transform={`translate(${ANCHO - 14}, ${n.alto / 2})`}>
                        <circle r={11} fill={n.color} />
                        <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill="#fff">+{n.ocultos}</text>
                      </g>
                    )}
                    {n.nodo.ampliacion && <text x={ANCHO - 20} y={16} fontSize={11}>⚠️</text>}
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </g>
        </svg>
      </div>
      <AnimatePresence>
        {seleccion && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="tarjeta flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="text-sm font-semibold text-slate-800">{textoPlano(seleccion.texto)}</p>
            <Citas fuentes={seleccion.fuentes} ampliacion={seleccion.ampliacion} alAbrir={alVerFuente} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
