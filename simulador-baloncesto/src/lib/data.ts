/**
 * Carga de datos. Modos:
 *  - "static" (por defecto): snapshot JSON generado por la ingesta y servido en /data/<comp>.json.
 *  - "supabase": se piden a la función de Netlify /api/snapshot, que lee Supabase en el servidor
 *    (las claves nunca llegan al navegador). Si falla, se usan los últimos datos válidos estáticos.
 */
import type { CompetitionSnapshot } from '../../engine/snapshot';
import type { CompetitionId } from '../../engine/datatypes';
import type { SimParams } from '../../engine/types';
import { DEFAULT_PARAMS } from '../../engine/types';
import calibration from '../../config/calibracion.json';

export interface LoadedSnapshot {
  snapshot: CompetitionSnapshot;
  origin: 'supabase' | 'estatico';
  warning?: string;
}

const cache = new Map<CompetitionId, Promise<LoadedSnapshot>>();

async function loadStatic(comp: CompetitionId): Promise<CompetitionSnapshot> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${comp}.json`);
  if (!r.ok) throw new Error(`No hay datos de ${comp} (HTTP ${r.status}). Ejecuta la ingesta: npm run ingest:${comp}`);
  return (await r.json()) as CompetitionSnapshot;
}

export function loadSnapshot(comp: CompetitionId): Promise<LoadedSnapshot> {
  if (!cache.has(comp)) {
    const p = (async (): Promise<LoadedSnapshot> => {
      if (import.meta.env.VITE_DATA_MODE === 'supabase') {
        try {
          const r = await fetch(`/api/snapshot?comp=${comp}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { snapshot: (await r.json()) as CompetitionSnapshot, origin: 'supabase' };
        } catch (e) {
          const snapshot = await loadStatic(comp);
          return {
            snapshot,
            origin: 'estatico',
            warning: `No se pudo leer Supabase (${(e as Error).message}); se muestran los últimos datos válidos del ${new Date(snapshot.generatedAt).toLocaleString('es-ES')}.`,
          };
        }
      }
      return { snapshot: await loadStatic(comp), origin: 'estatico' };
    })();
    p.catch(() => cache.delete(comp));
    cache.set(comp, p);
  }
  return cache.get(comp)!;
}

type CalibFile = Record<string, { params: Partial<SimParams>; calibratedAt: string; targets: Record<string, number>; simulated: Record<string, number> }>;

export function paramsFor(comp: CompetitionId): { params: SimParams; calibratedAt: string | null } {
  const c = (calibration as unknown as CalibFile)[comp];
  if (!c) return { params: DEFAULT_PARAMS, calibratedAt: null };
  return { params: { ...DEFAULT_PARAMS, ...c.params }, calibratedAt: c.calibratedAt };
}

export function calibrationInfo(comp: CompetitionId) {
  return (calibration as unknown as CalibFile)[comp] ?? null;
}
