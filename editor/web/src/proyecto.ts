import { api } from './api';
import { ajustarTextoDetectado } from './canvas/nodes';
import { renderizar } from './canvas/refs';
import { normalizarDoc } from './defaults';
import { asegurarFuente, cargarBiblioteca, registrarPropias } from './fonts';
import { useEditor } from './store';
import type { Doc, TextLayer } from './types';

const CLAVE_ULTIMO = 'estudio:ultimo-proyecto';

/** Abre un proyecto guardado: carga fuentes, coloca los textos detectados y lo muestra. */
export async function abrirProyecto(id: string) {
  const s = useEditor.getState();
  s.set({ ocupado: 'Abriendo proyecto…' });
  try {
    const crudo = (await api.leerProyecto(id)) as Partial<Doc>;
    let doc = normalizarDoc({ ...crudo, id });
    await cargarBiblioteca().catch(() => []);
    await registrarPropias(doc.customFonts);
    const textos = doc.layers.filter((l): l is TextLayer => l.type === 'text');
    await Promise.all(textos.map((t) => asegurarFuente(t.fontFamily, t.fontWeight)));
    doc = { ...doc, layers: doc.layers.map((l) => (l.type === 'text' ? ajustarTextoDetectado(l) : l)) };
    s.cargarDoc(doc);
    try {
      localStorage.setItem(CLAVE_ULTIMO, id);
    } catch {
      /* almacenamiento no disponible */
    }
    // si se recolocaron textos, se guarda la versión ya ajustada
    if (textos.some((t) => t.needsFit)) await guardarAhora();
  } catch (e) {
    s.avisar(`No se pudo abrir el proyecto: ${(e as Error).message}`, 'error');
    throw e;
  } finally {
    s.set({ ocupado: null });
  }
}

export function ultimoProyecto(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO);
  } catch {
    return null;
  }
}

let guardando: Promise<void> | null = null;
let ultimaMiniatura = 0;

export async function guardarAhora() {
  const s = useEditor.getState();
  const doc = s.doc;
  if (!doc.id) return;
  if (guardando) await guardando;
  s.set({ guardado: 'guardando' });
  guardando = (async () => {
    try {
      await api.guardarProyecto(doc.id, doc);
      // si no hubo cambios mientras se guardaba, queda guardado
      if (useEditor.getState().doc === doc) useEditor.getState().set({ guardado: 'guardado' });
      if (Date.now() - ultimaMiniatura > 8000) {
        ultimaMiniatura = Date.now();
        const c = renderizar(doc, { escala: Math.min(1, 480 / Math.max(doc.width, doc.height)) });
        const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
        if (b) await api.subirMiniatura(doc.id, b);
      }
    } catch {
      useEditor.getState().set({ guardado: 'error' });
    } finally {
      guardando = null;
    }
  })();
  await guardando;
}

/** Guardado automático: 1,5 s después del último cambio. */
export function activarAutoguardado() {
  let t: ReturnType<typeof setTimeout> | null = null;
  return useEditor.subscribe((estado, previo) => {
    if (estado.doc === previo.doc || !estado.doc.id) return;
    if (t) clearTimeout(t);
    t = setTimeout(() => void guardarAhora(), 1500);
  });
}
