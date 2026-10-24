import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Perfil } from "../lib/tipos";

interface Ctx {
  sesion: Session | null;
  perfil: Perfil | null;
  cargando: boolean;
  recargarPerfil: () => Promise<void>;
  salir: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>({ sesion: null, perfil: null, cargando: true, recargarPerfil: async () => {}, salir: async () => {} });

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setPerfil(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("id, nombre, fecha_nacimiento, consentimiento_estado, consentimiento_ia, tutor_email, preferencias").eq("id", s.user.id).maybeSingle();
    setPerfil((data as Perfil) ?? null);
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      await cargarPerfil(data.session);
      if (vivo) setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesion(s);
      void cargarPerfil(s);
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [cargarPerfil]);

  const valor: Ctx = {
    sesion,
    perfil,
    cargando,
    recargarPerfil: () => cargarPerfil(sesion),
    salir: async () => {
      await supabase.auth.signOut();
      setPerfil(null);
    },
  };
  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** ¿Puede usar la IA con sus apuntes? */
export function puedeUsarIA(p: Perfil | null): boolean {
  return Boolean(p && p.consentimiento_estado === "concedido" && p.consentimiento_ia);
}
