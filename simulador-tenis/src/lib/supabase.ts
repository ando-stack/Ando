import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase de SÓLO LECTURA. La clave anónima está pensada para ser pública: lo que
 * protege los datos es RLS (sólo hay políticas de lectura). La clave service_role nunca se usa
 * en el navegador.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon, { auth: { persistSession: false } }) : null;
