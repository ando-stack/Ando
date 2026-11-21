import type { Category, ErrorType, Severity } from "./types";

export function fmtTime(t: number | null | undefined, withTenths = false): string {
  if (t == null || Number.isNaN(t)) return "--:--";
  const total = Math.max(0, t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = withTenths ? s.toFixed(1).padStart(4, "0") : Math.floor(s).toString().padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return fmtDate(iso);
}

export const CATEGORY_LABEL: Record<Category, string> = {
  positioning: "Posicionamiento", rotation: "Rotaciones", fight: "Peleas", endgame: "Endgame",
  decision: "Decisiones", mechanics: "Mecánicas", materials: "Materiales", healing: "Curaciones",
  survival: "Supervivencia", communication: "Comunicación",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  mechanical: "Mecánico", positioning: "Posicionamiento", decision: "Decisión", strategy: "Estrategia", communication: "Comunicación",
};

export const SEVERITY_LABEL: Record<Severity, string> = { low: "Leve", medium: "Media", high: "Alta", critical: "Crítica" };
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "var(--color-sev-low)", medium: "var(--color-sev-medium)", high: "var(--color-sev-high)", critical: "var(--color-sev-critical)",
};

export const PHASE_LABEL: Record<string, string> = { early: "Early", mid: "Mid", end: "Endgame" };

export const STATUS_LABEL: Record<string, string> = {
  draft: "Sin archivo", uploaded: "Listo para analizar", queued: "En cola", processing: "Analizando",
  completed: "Analizada", failed: "Error", incompatible: "Incompatible",
};

export function scoreTone(s: number | null | undefined): string {
  if (s == null) return "text-ink-3";
  if (s >= 80) return "text-ok";
  if (s >= 60) return "text-ink";
  if (s >= 40) return "text-sev-medium";
  return "text-sev-critical";
}
