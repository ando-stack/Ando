/**
 * Simulaciones guardadas: en IndexedDB del navegador y, si está configurado Supabase,
 * también en la tabla saved_simulations a través de la función de Netlify /api/simulations.
 */
import type { SimRun } from './types';

const DB = 'simulador-baloncesto';
const STORE = 'simulaciones';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRun(run: SimRun) {
  await tx('readwrite', (s) => s.put(run));
  if (import.meta.env.VITE_DATA_MODE === 'supabase') {
    try {
      await fetch('/api/simulations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run) });
    } catch {
      /* el guardado local ya está hecho */
    }
  }
}

export async function listRuns(): Promise<SimRun[]> {
  try {
    const all = await tx<SimRun[]>('readonly', (s) => s.getAll() as IDBRequest<SimRun[]>);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function deleteRun(id: string) {
  await tx('readwrite', (s) => s.delete(id));
}
