// Cliente de la API del backend. Todas las peticiones llevan el identificador
// aleatorio del navegador (X-Client-Token); sin él no se accede a ningún trabajo.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Format = "docx" | "xlsx" | "pptx" | "pdf" | "csv";
export type FormatPref = "auto" | Format;
export type StageStatus = "pending" | "running" | "done" | "error" | "skipped";
export type JobStatus = "uploaded" | "analyzing" | "analyzed" | "analyzed_error" | "generating" | "completed" | "needs_review" | "failed";

export interface Stage { key: string; label: string; status: StageStatus; detail: string; started_at: string | null; finished_at: string | null }
export interface JobFile {
  id: string; name: string; kind: string; ext: string; size: number;
  ingest?: { ok: boolean; error: string | null; chars: number; images: number; truncated: boolean; summary: string };
}
export interface Requirement { id: string; text: string; source: string; exercise_id: string; kind: string; mandatory: boolean }
export interface Exercise { id: string; title: string; description: string; source_files: string[]; deliverable_id: string | null }
export interface DeliverableSpec { id: string; format: Format; filename: string; base_file_id: string | null; description: string; format_explicitly_required: boolean }
export interface Issue { text: string; suggestion: string }
export interface Analysis {
  title: string; subject: string; summary: string; exercises: Exercise[]; requirements: Requirement[]; resources: string[];
  deliverables: DeliverableSpec[]; tools_needed: string[]; ambiguities: Issue[]; impossible: Issue[]; suspicious_instructions: string[];
}
export interface Step { n: number; op: string; covers: string[]; explanation: string; status: "ok" | "error"; message: string }
export interface Output { id: string; deliverable_id: string; name: string; format: Format; size: number; purpose: string }
export interface Check { description: string; ok: boolean; covers?: string[]; detail?: string }
export interface DeliverableReport {
  id: string; filename: string; format: Format; opens: boolean; checks: Check[]; template: Check[];
  formula_errors: { sheet: string; cell: string; formula: string; value: string }[]; failed_steps: { n: number; op: string; message: string }[];
  warnings: string[]; notes: string[];
}
export interface Version {
  version: number; created_at: string; feedback: string | null; format_pref: FormatPref; status: JobStatus; outputs: Output[]; warnings: string[];
  deliverables: { id: string; filename: string; format: Format; ok: boolean; error: string | null; purpose: string; base_file_id: string | null; steps: Step[] }[];
  validation: { deliverables: DeliverableReport[]; problems: string[]; coverage: Record<string, string>; formula_engine: boolean; notes?: string[] };
  review: { items: { requirement_id: string; status: "hecho" | "parcial" | "pendiente"; comment: string }[]; overall: string } | null;
}
export interface SecurityFlag { source: string; reason: string; snippet: string }
export interface Job {
  id: string; title: string; status: JobStatus; stage: string; progress: Stage[]; error: string | null; files: JobFile[];
  analysis: Analysis | null; versions: Version[]; warnings: string[]; security_flags: SecurityFlag[];
  student_name: string; date: string; created_at: string; updated_at: string; expires_at_ts: number; format_pref?: FormatPref;
}
export interface JobSummary { id: string; title: string; status: JobStatus; created_at: string; student_name: string; files: number; versions: number; subject: string | null; expires_at_ts: number }
export interface Health {
  ok: boolean; ai_configured: boolean; model: string; formula_engine: boolean; pdf_conversion: boolean;
  limits: { max_file_mb: number; max_total_mb: number; max_files: number; retention_hours: number; jobs_per_day: number };
  formats: { input: string[]; output: string[] };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const TOKEN_KEY = "cf_client_token";

export function clientToken(): string {
  let t = "";
  try { t = localStorage.getItem(TOKEN_KEY) || ""; } catch { /* almacenamiento bloqueado */ }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(t)) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    t = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* sin persistencia: el token dura la sesión */ }
  }
  return t;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { "X-Client-Token": clientToken(), ...(init.headers || {}) } });
  } catch {
    throw new ApiError(0, "No se puede conectar con el servidor de ClassForge. ¿Está arrancado el backend?");
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      else if (Array.isArray(body.detail)) msg = body.detail.map((d: { msg: string }) => d.msg).join(" · ");
    } catch { /* cuerpo no JSON */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  createJob: (files: File[], studentName: string, date: string, extraNotes: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    fd.append("student_name", studentName);
    fd.append("date", date);
    fd.append("extra_notes", extraNotes);
    return request<Job>("/api/jobs", { method: "POST", body: fd });
  },
  listJobs: () => request<JobSummary[]>("/api/jobs"),
  getJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  deleteJob: (id: string) => request<void>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  analyze: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/analyze`, { method: "POST" }),
  generate: (id: string, format_pref: FormatPref, extra_notes: string) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format_pref, extra_notes }) }),
  revise: (id: string, feedback: string, format_pref?: FormatPref) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/revise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback, format_pref }) }),
  preview: (jobId: string, fileId: string) => request<string>(`/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}/preview`),
};

/** Descarga autenticada: se pide con fetch (lleva la cabecera) y se guarda como blob. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: { "X-Client-Token": clientToken() } });
  } catch {
    throw new ApiError(0, "No se pudo conectar para descargar el archivo.");
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 410 ? "El archivo ha caducado y ya no está disponible." : `No se pudo descargar (${res.status}).`);
  const blob = await res.blob();
  const disp = res.headers.get("content-disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const plain = /filename="?([^";]+)"?/i.exec(disp);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const fileUrl = (jobId: string, fileId: string) => `/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`;
export const zipUrl = (jobId: string, version: number, withSteps: boolean) => `/api/jobs/${encodeURIComponent(jobId)}/versions/${version}/zip?with_steps=${withSteps}`;
