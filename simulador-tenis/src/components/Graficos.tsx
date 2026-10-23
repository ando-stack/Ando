import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Histograma } from '../../engine/agregacion';
import { pct } from '../lib/formato';

/** Paleta validada (modo oscuro) del método de visualización: A = azul, B = naranja. */
export const COLOR_A = '#3987e5';
export const COLOR_B = '#d95926';
const EJE = '#8f8e86';
const REJILLA = '#34332f';
const SUPERFICIE = '#1a1a19';

const estiloTooltip = {
  contentStyle: { background: '#232321', border: '1px solid #34332f', borderRadius: 8, color: '#f0efec', fontSize: 12 },
  labelStyle: { color: '#c3c2b7' },
  cursor: { fill: 'rgba(240,239,236,0.06)' },
};

/** Distribución de una variable (barras verticales, una serie). */
export function GraficoDistribucion({ h, etiqueta, alto = 200, color = COLOR_A }: { h: Histograma; etiqueta: string; alto?: number; color?: string }) {
  const total = h.cuentas.reduce((a, b) => a + b, 0) || 1;
  const datos = h.cuentas.map((v, i) => ({ x: h.min + i, p: v / total, veces: v }));
  return (
    <div style={{ height: alto }} className="w-full" aria-label={`Distribución de ${etiqueta}`}>
      <ResponsiveContainer>
        <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={REJILLA} />
          <XAxis dataKey="x" stroke={EJE} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={EJE} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={40} tickLine={false} axisLine={false} />
          <Tooltip {...estiloTooltip} formatter={(v: number, _n, item) => [`${pct(v)} (${item.payload.veces.toLocaleString('es-ES')} veces)`, etiqueta]} labelFormatter={(l) => `${etiqueta}: ${l}`} />
          <Bar dataKey="p" fill={color} radius={[4, 4, 0, 0]} stroke={SUPERFICIE} strokeWidth={1} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Dos distribuciones superpuestas en barras agrupadas (A y B), con leyenda. */
export function GraficoComparado({ ha, hb, nombreA, nombreB, etiqueta, alto = 200 }: { ha: Histograma; hb: Histograma; nombreA: string; nombreB: string; etiqueta: string; alto?: number }) {
  const min = Math.min(ha.min, hb.min);
  const max = Math.max(ha.min + ha.cuentas.length - 1, hb.min + hb.cuentas.length - 1);
  const ta = ha.cuentas.reduce((a, b) => a + b, 0) || 1;
  const tb = hb.cuentas.reduce((a, b) => a + b, 0) || 1;
  const datos = [];
  for (let x = min; x <= max; x++) datos.push({ x, a: (ha.cuentas[x - ha.min] ?? 0) / ta, b: (hb.cuentas[x - hb.min] ?? 0) / tb });
  return (
    <div style={{ height: alto }} className="w-full" aria-label={`Distribución comparada de ${etiqueta}`}>
      <ResponsiveContainer>
        <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke={REJILLA} />
          <XAxis dataKey="x" stroke={EJE} tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis stroke={EJE} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={40} tickLine={false} axisLine={false} />
          <Tooltip {...estiloTooltip} formatter={(v: number, n) => [pct(v), n]} labelFormatter={(l) => `${etiqueta}: ${l}`} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#c3c2b7' }} />
          <Bar dataKey="a" name={nombreA} fill={COLOR_A} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="b" name={nombreB} fill={COLOR_B} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras horizontales de frecuencias (p. ej. resultado en sets), una serie. */
export function GraficoFrecuencias({ filas, n, alto }: { filas: { clave: string; veces: number }[]; n: number; alto?: number }) {
  const datos = filas.slice(0, 12).map((f) => ({ clave: f.clave, p: f.veces / n, veces: f.veces }));
  return (
    <div style={{ height: alto ?? Math.max(120, datos.length * 26 + 30) }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={2}>
          <CartesianGrid horizontal={false} stroke={REJILLA} />
          <XAxis type="number" stroke={EJE} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
          <YAxis type="category" dataKey="clave" stroke={EJE} tick={{ fontSize: 11 }} width={90} tickLine={false} />
          <Tooltip {...estiloTooltip} formatter={(v: number, _n, item) => [`${pct(v)} (${item.payload.veces.toLocaleString('es-ES')} veces)`, 'Frecuencia']} />
          <Bar dataKey="p" fill={COLOR_A} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Evolución temporal (ranking o Elo) de una serie. */
export function GraficoEvolucion({ puntos, etiqueta, invertido = false }: { puntos: [string, number][]; etiqueta: string; invertido?: boolean }) {
  const datos = puntos.map(([f, v]) => ({ f, v }));
  return (
    <div className="h-48 w-full" aria-label={`Evolución de ${etiqueta}`}>
      <ResponsiveContainer>
        <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={REJILLA} />
          <XAxis dataKey="f" stroke={EJE} tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis stroke={EJE} tick={{ fontSize: 11 }} reversed={invertido} domain={['auto', 'auto']} width={48} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={estiloTooltip.contentStyle} labelStyle={estiloTooltip.labelStyle} formatter={(v: number) => [v.toLocaleString('es-ES'), etiqueta]} />
          <Line type="monotone" dataKey="v" stroke={COLOR_A} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
