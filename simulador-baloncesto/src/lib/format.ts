export const fmtPct = (p: number, d = 1) =>
  Number.isFinite(p) ? (p * 100).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %' : '—';
export const fmtNum = (x: number, d = 1) =>
  Number.isFinite(x) ? x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
export const fmtInt = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString('es-ES') : '—');
export const fmtOdds = (p: number) => (p > 0 ? (1 / p).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
export const fmtLine = (l: number) => (l > 0 && !Number.isInteger(l) ? '' : '') + l.toLocaleString('es-ES', { minimumFractionDigits: Number.isInteger(l) ? 0 : 1 });
export const fmtSigned = (l: number) => (l > 0 ? '+' : '') + fmtLine(l);
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '—');

/** Exporta filas a CSV (separador ';' y coma decimal, compatible con Excel en español). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? v.toLocaleString('es-ES', { useGrouping: false, maximumFractionDigits: 6 }) : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w\-.áéíóúñ ]+/gi, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
