import type {Project} from './types';

export interface Job {
  id: string;
  kind: string;
  project: string | null;
  label: string;
  status: 'pendiente' | 'ejecutando' | 'completada' | 'error' | 'cancelada';
  progress: number;
  message: string;
  error: string | null;
  warnings: string[];
  result: unknown;
}

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => fetch(url).then((r) => handle<T>(r)),
  post: <T>(url: string, body?: unknown) =>
    fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body ?? {})}).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(url, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then((r) => handle<T>(r)),
};

export const projectUrl = (name: string) => `/api/projects/${encodeURIComponent(name)}`;
export const fileUrl = (name: string, rel: string) => `/files/${encodeURIComponent(name)}/${rel}`;

export function uploadFile(importId: string, file: File, onProgress: (p: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/imports/${importId}/files`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else {
        let msg = xhr.statusText;
        try {
          msg = JSON.parse(xhr.responseText).detail;
        } catch {
          /* */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

/** Sondea una tarea hasta que termina. Devuelve la tarea final. */
export async function waitJob(id: string, onUpdate?: (j: Job) => void): Promise<Job> {
  for (;;) {
    const j = await api.get<Job>(`/api/jobs/${id}`);
    onUpdate?.(j);
    if (j.status === 'completada' || j.status === 'error' || j.status === 'cancelada') return j;
    await new Promise((r) => setTimeout(r, 700));
  }
}

export const cancelJob = (id: string) => api.post(`/api/jobs/${id}/cancel`);

export const loadProject = (name: string) => api.get<Project>(projectUrl(name));
