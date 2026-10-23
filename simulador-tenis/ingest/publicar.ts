/** Escritura del snapshot JSON que sirve la web (public/data). */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParamsModelo } from '../engine/modelo';
import type { DetalleTorneo, EntradaIndice, FichaJugador, MetaDatos, TorneoVivo } from '../src/lib/tiposDatos';
import { NUM_FRAGMENTOS, fragmentoDe } from '../src/lib/fragmentos';
import { log } from './lib/util';

export const DIR_PUBLICO = join(import.meta.dirname, '..', 'public', 'data');

const escribir = (ruta: string, datos: unknown) => writeFileSync(ruta, JSON.stringify(datos));

/** Borra de un directorio los ficheros que ya no se publican (sin borrar el directorio). */
function limpiar(dir: string, vigentes: Set<string>) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) if (!vigentes.has(f)) rmSync(join(dir, f), { force: true });
}

export function publicar(p: {
  meta: MetaDatos;
  modelo: ParamsModelo;
  torneos: TorneoVivo[];
  detalles: DetalleTorneo[];
  indice: EntradaIndice[];
  fichas: Map<string, FichaJugador>;
  conservarTorneos: boolean;
}) {
  mkdirSync(DIR_PUBLICO, { recursive: true });
  escribir(join(DIR_PUBLICO, 'meta.json'), p.meta);
  escribir(join(DIR_PUBLICO, 'modelo.json'), p.modelo);
  if (!p.conservarTorneos) {
    const dirT = join(DIR_PUBLICO, 'torneos');
    mkdirSync(dirT, { recursive: true });
    limpiar(dirT, new Set(p.detalles.map((d) => `${d.torneo.id}.json`)));
    const orden = [...p.torneos].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.circuito.localeCompare(b.circuito) || a.nombre.localeCompare(b.nombre));
    escribir(join(DIR_PUBLICO, 'torneos.json'), orden);
    for (const d of p.detalles) escribir(join(dirT, `${d.torneo.id}.json`), d);
  }
  escribir(join(DIR_PUBLICO, 'jugadores.json'), p.indice);
  const dirJ = join(DIR_PUBLICO, 'jugadores');
  mkdirSync(dirJ, { recursive: true });
  limpiar(dirJ, new Set(Array.from({ length: NUM_FRAGMENTOS }, (_, i) => `${i}.json`)));
  const frag: Record<string, FichaJugador>[] = Array.from({ length: NUM_FRAGMENTOS }, () => ({}));
  for (const [id, f] of p.fichas) frag[fragmentoDe(id)][id] = f;
  frag.forEach((f, i) => escribir(join(dirJ, `${i}.json`), f));
  log('Publicado en', DIR_PUBLICO, readdirSync(dirJ).length, 'fragmentos de jugadores');
}
