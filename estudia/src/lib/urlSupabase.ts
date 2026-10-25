/**
 * Normaliza la URL de Supabase aunque se haya pegado con errores típicos:
 * barra final, "/rest/v1/", espacios, comillas o la dirección del panel
 * (https://supabase.com/dashboard/project/<ref>/...).
 */
export function normalizarUrlSupabase(bruta: string | undefined | null): string {
  let s = String(bruta ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!s) return "";
  const panel = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (panel) return `https://${panel[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}
