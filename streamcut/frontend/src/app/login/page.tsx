"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo, Spinner } from "@/components/ui";
import { api, ApiError, post } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const state = useQuery({ queryKey: ["auth-state"], queryFn: () => api<{ needs_setup: boolean }>("/auth/state") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = state.data?.needs_setup;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setup) await post("/auth/setup", { email, password, display_name: name || email.split("@")[0] });
      else await post("/auth/login", { email, password });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-accent/20 blur-[140px]" />
      <div className="card relative w-full max-w-sm p-7 animate-fade-in">
        <Logo />
        <h1 className="mt-6 text-lg font-semibold">{setup ? "Configura tu estudio" : "Inicia sesión"}</h1>
        <p className="mt-1 text-sm text-muted">
          {setup ? "Crea la cuenta de administrador. Solo se hace una vez." : "Accede a tus directos, clips y biblioteca."}
        </p>
        {state.isLoading ? <div className="py-10 text-center"><Spinner /></div> : (
          <form className="mt-6 space-y-3.5" onSubmit={submit}>
            {setup && (
              <label className="block space-y-1.5"><span className="label">Nombre</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
            )}
            <label className="block space-y-1.5"><span className="label">Email</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            <label className="block space-y-1.5"><span className="label">Contraseña</span>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 10 : undefined} required />
              {setup && <span className="block text-[11px] text-faint">Mínimo 10 caracteres.</span>}</label>
            {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
            <button className="btn-primary h-10 w-full" disabled={busy}>{busy && <Spinner />}{setup ? "Crear cuenta" : "Entrar"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
