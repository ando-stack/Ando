export const VERSION_POLITICA = "2026-10-01";

export function edadDesde(fecha: string, hoy = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const [y, m, d] = fecha.split("-").map(Number);
  let edad = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad--;
  return edad;
}
