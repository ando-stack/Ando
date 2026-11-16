export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || Number.isNaN(s)) return "—";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtTimecode(s: number): string {
  const sign = s < 0 ? "-" : "";
  const t = Math.abs(s);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${sign}${m}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

export function fmtDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-ES", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "hace un momento";
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return `hace ${Math.round(diff / 86400)} d`;
}

export function since(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmtDuration((Date.now() - new Date(iso).getTime()) / 1000);
}

export const CATEGORY_LABELS: Record<string, string> = {
  funny: "Divertido", reaction: "Reacción", scare: "Susto", epic_play: "Jugada", victory: "Victoria",
  defeat: "Derrota", fail: "Error gracioso", story: "Historia", conversation: "Conversación", hype: "Emoción",
  chat: "Chat",
};

export const STATUS_LABELS: Record<string, string> = {
  detected: "Detectado", pending: "Pendiente", processing: "Procesando", editing: "Editando", approved: "Aprobado",
  rejected: "Rechazado", exported: "Exportado", published: "Publicado",
};

export const JOB_STATUS: Record<string, string> = {
  queued: "En cola", running: "En curso", succeeded: "Completado", failed: "Fallido", cancelled: "Cancelado",
};

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
