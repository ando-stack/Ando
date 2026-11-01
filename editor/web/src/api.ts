/** Cliente del motor local (FastAPI en 127.0.0.1). */

export class ErrorApi extends Error {}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `Error ${r.status}`;
    try {
      const d = await r.json();
      msg = d.detalle ?? d.detail ?? msg;
      if (Array.isArray(msg)) msg = 'Datos no válidos.';
    } catch {
      /* respuesta sin JSON */
    }
    throw new ErrorApi(String(msg));
  }
  return r.json() as Promise<T>;
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new ErrorApi('No se puede conectar con el motor local. ¿Está arrancado? (scripts/iniciar)');
  }
  return json<T>(r);
}

const post = <T>(url: string, cuerpo: unknown) =>
  pedir<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

export interface EstadoMotor {
  version: string;
  dispositivo: { dispositivo: string; nombre: string; torch: string; hilos_cpu: number };
  modelos: { clave: string; tarea: string; licencia: string; disponible: boolean; opcional: boolean }[];
  nube: { activada: boolean; solicitada: boolean; hay_clave: boolean; proveedor: string; modelo: string; calidad: string };
}

export interface Trabajo {
  id: string;
  proyecto_id: string;
  estado: 'en_cola' | 'procesando' | 'listo' | 'error';
  progreso: number;
  mensaje: string;
  avisos: string[];
  proyecto: unknown;
}

export interface ResumenProyecto {
  id: string;
  name: string;
  updatedAt: number;
  width: number;
  height: number;
  thumbnail: string | null;
}

export const api = {
  estado: () => pedir<EstadoMotor>('/api/estado'),
  fuentes: () => pedir<{ familia: string; categoria: string; licencia: string; ficheros: { url: string; peso: number; variable: boolean }[] }[]>('/api/fuentes'),
  recursosLibres: () => pedir<{ overlays: string[]; textures: string[]; shapes: string[] }>('/api/recursos-libres'),

  proyectos: () => pedir<ResumenProyecto[]>('/api/proyectos'),
  crearProyecto: (d: unknown) => post<{ id: string }>('/api/proyectos', d),
  leerProyecto: (id: string) => pedir<unknown>(`/api/proyectos/${id}`),
  guardarProyecto: (id: string, d: unknown) =>
    pedir<{ ok: boolean }>(`/api/proyectos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }),
  borrarProyecto: (id: string) => pedir<{ ok: boolean }>(`/api/proyectos/${id}`, { method: 'DELETE' }),

  subirRecurso: (pid: string, archivo: Blob, nombre = 'recurso.png') => {
    const f = new FormData();
    f.append('archivo', archivo, nombre);
    return pedir<{ url: string; width: number; height: number }>(`/api/proyectos/${pid}/recursos`, { method: 'POST', body: f });
  },
  subirFuente: (pid: string, archivo: File) => {
    const f = new FormData();
    f.append('archivo', archivo, archivo.name);
    return pedir<{ url: string; familia: string }>(`/api/proyectos/${pid}/fuentes`, { method: 'POST', body: f });
  },
  subirMiniatura: (pid: string, archivo: Blob) => {
    const f = new FormData();
    f.append('archivo', archivo, 'miniatura.jpg');
    return pedir<{ ok: boolean }>(`/api/proyectos/${pid}/miniatura`, { method: 'POST', body: f });
  },

  descomponer: (archivo: File) => {
    const f = new FormData();
    f.append('archivo', archivo, archivo.name);
    f.append('nombre', archivo.name.replace(/\.[^.]+$/, ''));
    return pedir<{ trabajo: string; proyecto: string; avisos: string[] }>('/api/descomponer', { method: 'POST', body: f });
  },
  trabajo: (id: string) => pedir<Trabajo>(`/api/trabajos/${id}`),

  quitarFondo: (proyecto: string, recurso: string) =>
    post<{ url: string; x: number; y: number; width: number; height: number; avisos: string[] }>('/api/ia/quitar-fondo', { proyecto, recurso }),
  segmentar: (cuerpo: { proyecto: string; recurso: string; puntos?: { x: number; y: number; positivo: boolean }[]; caja?: number[]; mascara?: string; quitar_del_origen?: boolean }) =>
    post<{ capa: { src: string; x: number; y: number; width: number; height: number; confidence: number }; origen?: string; avisos: string[] }>('/api/ia/segmentar', cuerpo),
  borrarIA: (proyecto: string, recurso: string, mascara: string) => post<{ url: string; avisos: string[] }>('/api/ia/borrar', { proyecto, recurso, mascara }),
  dividir: (proyecto: string, recurso: string) =>
    post<{ partes: { url: string; x: number; y: number; width: number; height: number }[] }>('/api/ia/dividir', { proyecto, recurso }),
  optimizarPng: async (png: Blob, maxBytes: number): Promise<Blob> => {
    const f = new FormData();
    f.append('archivo', png, 'export.png');
    f.append('max_bytes', String(maxBytes));
    let r: Response;
    try {
      r = await fetch('/api/ia/optimizar-png', { method: 'POST', body: f });
    } catch {
      throw new ErrorApi('No se puede conectar con el motor local.');
    }
    if (!r.ok) await json(r);
    return r.blob();
  },

  nube: (w: number, h: number) =>
    pedir<{ activada: boolean; solicitada: boolean; hay_clave: boolean; proveedor: string; modelo: string; calidad: string; aviso: string; coste: { usd_por_imagen: number | null; tamano: string; nota: string } }>(
      `/api/nube?width=${w}&height=${h}`,
    ),
  rellenoGenerativo: (cuerpo: { proyecto: string; recurso: string; prompt: string; mascara?: string; ampliar?: Record<string, number>; confirmado: boolean }) =>
    post<{ url: string; width: number; height: number }>('/api/nube/relleno-generativo', cuerpo),
};
