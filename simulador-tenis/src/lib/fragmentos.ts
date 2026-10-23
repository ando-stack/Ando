/** Las fichas de jugador se reparten en fragmentos para no descargar todos los perfiles. */
export const NUM_FRAGMENTOS = 128;

export function fragmentoDe(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % NUM_FRAGMENTOS;
}
