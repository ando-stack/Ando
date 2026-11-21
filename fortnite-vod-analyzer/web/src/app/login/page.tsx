"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/AppShell";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) router.replace("/"); }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name || undefined);
      router.replace("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:block">
        <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">VOD review profesional</div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight">Cada error, con su minuto exacto y su solución.</h1>
            <p className="mt-4 text-ink-2">Sube un vídeo o una replay. El análisis se basa solo en lo que se ve en los fotogramas o consta en los datos de la partida.</p>
            <div className="mt-8 grid grid-cols-3 gap-3 text-sm">
              {["Posicionamiento", "Rotaciones", "Peleas", "Endgame", "Decisiones", "Mecánicas"].map((x) => (
                <div key={x} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink-2">{x}</div>
              ))}
            </div>
          </div>
          <div className="text-xs text-ink-3">Puntuaciones orientativas · No afiliado a Epic Games</div>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="fade-in w-full max-w-sm space-y-4">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Inicia sesión" : "Crea tu cuenta de coach"}</h2>
            <p className="mt-1 text-sm text-ink-3">{mode === "login" ? "Accede a tus jugadores y análisis." : "Tus jugadores y vídeos solo son visibles para ti."}</p>
          </div>
          {mode === "register" && <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          <Field label="Contraseña" hint={mode === "register" ? "Mínimo 8 caracteres" : undefined}>
            <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>{mode === "login" ? "Entrar" : "Crear cuenta"}</Button>
          <button type="button" className="w-full text-center text-sm text-ink-3 hover:text-ink" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
