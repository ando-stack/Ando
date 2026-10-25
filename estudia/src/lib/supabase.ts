// Cliente de Supabase para el navegador: solo usa la clave pública "anon" (protegida por RLS).
import { createClient } from "@supabase/supabase-js";
import { normalizarUrlSupabase } from "./urlSupabase";

const url = normalizarUrlSupabase(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim().replace(/^["']|["']$/g, "");

export const configuracionCompleta = Boolean(url && anon);

export const supabase = createClient(url || "http://localhost:54321", anon || "falta-configurar", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
