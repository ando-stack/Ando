"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, configureApi, post } from "./api";
import type { User } from "./types";

const MODE = (process.env.NEXT_PUBLIC_AUTH_MODE || "local") as "local" | "supabase";
const TOKEN_KEY = "fva.token";

let supabase: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY");
    supabase = createClient(url, key);
  }
  return supabase;
}

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

async function getToken(): Promise<string | null> {
  if (MODE === "supabase") {
    const { data } = await sb().auth.getSession();
    return data.session?.access_token ?? null;
  }
  return readToken();
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  mode: "local" | "supabase";
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const logout = useCallback(async () => {
    if (MODE === "supabase") await sb().auth.signOut();
    writeToken(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    configureApi(getToken, () => { writeToken(null); setUser(null); router.replace("/login"); });
    (async () => {
      try {
        if (await getToken()) setUser(await api<User>("/auth/me"));
      } catch { writeToken(null); }
      setLoading(false);
    })();
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    if (MODE === "supabase") {
      const { error } = await sb().auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    } else {
      const r = await post<{ token: string }>("/auth/login", { email, password });
      writeToken(r.token);
    }
    setUser(await api<User>("/auth/me"));
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    if (MODE === "supabase") {
      const { error, data } = await sb().auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error("Revisa tu email para confirmar la cuenta y después inicia sesión.");
    } else {
      const r = await post<{ token: string }>("/auth/register", { email, password, display_name: name });
      writeToken(r.token);
    }
    setUser(await api<User>("/auth/me"));
  }, []);

  const value = useMemo(() => ({ user, loading, mode: MODE, login, register, logout }), [user, loading, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
