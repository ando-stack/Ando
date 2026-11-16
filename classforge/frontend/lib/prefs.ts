// Preferencias locales del usuario (solo en este navegador).
import type { FormatPref } from "./api";

export interface Prefs { name: string; formatPref: FormatPref; theme: "dark" | "light"; zipWithSteps: boolean; currentJob: string | null }

const KEY = "cf_prefs";
export const defaultPrefs: Prefs = { name: "", formatPref: "auto", theme: "dark", zipWithSteps: true, currentJob: null };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* almacenamiento no disponible */ }
}

export function todayEs(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** dd/mm/aaaa <-> aaaa-mm-dd para el selector de fecha nativo. */
export const esToIso = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
export const isoToEs = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-ES");
}

export const ACCEPT = ".docx,.xlsx,.xlsm,.pptx,.pdf,.csv,.txt,.md,.png,.jpg,.jpeg";
export const ALLOWED_EXT = ACCEPT.split(",").map((e) => e.slice(1));
