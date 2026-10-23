import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { fmtPct } from '../lib/format';

export interface BarDatum {
  x: string | number;
  pct: number;
  count?: number;
}

/** Gráfico de barras de una distribución (porcentaje de simulaciones por valor). */
export default function BarChartCard({ title, data, color = '#f59e0b', refX, height = 220 }: { title: string; data: BarDatum[]; color?: string; refX?: number | string; height?: number }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-white mb-2 text-sm">{title}</h3>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#232c3d" vertical={false} />
            <XAxis dataKey="x" tick={{ fill: '#94a3b8', fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickFormatter={(v: number) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`} tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              contentStyle={{ background: '#121826', border: '1px solid #232c3d', borderRadius: 8, fontSize: 12 }}
              formatter={(v: number, _n, item) => [`${fmtPct(v)}${item?.payload?.count != null ? ` (${item.payload.count.toLocaleString('es-ES')} veces)` : ''}`, 'Frecuencia']}
              labelStyle={{ color: '#e2e8f0' }}
            />
            {refX != null && <ReferenceLine x={refX} stroke="#64748b" strokeDasharray="3 3" />}
            <Bar dataKey="pct" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
