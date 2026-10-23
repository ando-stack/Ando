/** Formato de números y utilidades de presentación (es-ES). */
export const pct = (x: number, dec = 1) => `${(100 * x).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`;
export const num = (x: number, dec = 2) => x.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const entero = (x: number) => x.toLocaleString('es-ES');
/** Cuota justa = 1 / probabilidad. */
export const cuota = (p: number) => (p > 0 ? num(1 / p, 2) : '—');
export const linea = (x: number) => x.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const signo = (x: number) => (x > 0 ? `+${linea(x)}` : linea(x));

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

export function hora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
}

/** Día en Europe/Madrid (YYYY-MM-DD). */
export function diaMadrid(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(iso));
}

export function edad(nacimiento: string | null | undefined): number | null {
  if (!nacimiento) return null;
  const n = new Date(nacimiento);
  if (Number.isNaN(n.getTime())) return null;
  return Math.floor((Date.now() - n.getTime()) / (365.25 * 86400000));
}

export function descargarCsv(nombre: string, cabecera: string[], filas: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" y BOM para que Excel en español lo abra bien.
  const txt = '﻿' + [cabecera, ...filas].map((f) => f.map(esc).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre.endsWith('.csv') ? nombre : `${nombre}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
