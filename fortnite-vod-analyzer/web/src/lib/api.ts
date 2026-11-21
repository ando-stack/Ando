"use client";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

let tokenGetter: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => {};

export function configureApi(getter: () => Promise<string | null>, unauthorized: () => void) {
  tokenGetter = getter;
  onUnauthorized = unauthorized;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function messageFrom(data: any, fallback: string): string {
  const d = data?.detail ?? data;
  if (typeof d === "string") return d;
  if (d?.message) return d.message;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(" · ");
  return fallback;
}

export async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenGetter();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "No se puede conectar con el servidor de análisis. ¿Está el backend en marcha?");
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, messageFrom(data, `Error ${res.status}`), data);
  }
  return res;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export async function downloadFile(path: string, fallbackName: string) {
  const res = await apiRaw(path);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Resumable chunked upload with progress. */
export async function uploadFile(
  matchId: string,
  file: File,
  kind: "video" | "replay",
  onProgress: (sent: number, total: number, speedBps: number) => void,
  signal?: AbortSignal,
) {
  const up = await post<{ id: string; chunk_bytes: number; received_bytes: number }>("/uploads", {
    match_id: matchId, filename: file.name, size_bytes: file.size, kind,
  });
  let offset = 0;
  const started = performance.now();
  while (offset < file.size) {
    if (signal?.aborted) {
      await del(`/uploads/${up.id}`).catch(() => {});
      throw new ApiError(0, "Subida cancelada");
    }
    const chunk = file.slice(offset, Math.min(file.size, offset + up.chunk_bytes));
    let attempt = 0;
    for (;;) {
      try {
        const r = await api<{ received_bytes: number }>(`/uploads/${up.id}?offset=${offset}`, {
          method: "PUT", body: chunk, headers: { "Content-Type": "application/octet-stream" }, signal,
        });
        offset = r.received_bytes;
        break;
      } catch (e) {
        attempt += 1;
        if (e instanceof ApiError && e.status === 409) {
          const st = await api<{ received_bytes: number }>(`/uploads/${up.id}`);
          offset = st.received_bytes; // resume from what the server has
          break;
        }
        if (attempt >= 4 || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      }
    }
    const secs = (performance.now() - started) / 1000;
    onProgress(offset, file.size, secs > 0 ? offset / secs : 0);
  }
  return post<{ upload: any; media: any }>(`/uploads/${up.id}/complete`);
}
