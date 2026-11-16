"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { api, ApiError, setAccessKey } from "@/lib/api";
import { Banner, Spinner } from "./ui";

/** Pide el código de acceso de la clase cuando el servidor lo exige. */
export default function AccessGate({ onOk }: { onOk: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setAccessKey(code.trim());
    try {
      await api.checkAccess();
      onOk();
    } catch (x) {
      setAccessKey("");
      setErr(x instanceof ApiError && x.status === 403 ? "Código incorrecto." : (x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/90 p-4 backdrop-blur">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6 animate-fade-up">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent"><KeyRound className="h-6 w-6" /></div>
        <div>
          <h2 className="text-lg font-semibold">Código de acceso</h2>
          <p className="mt-1 text-sm text-muted">Este ClassForge es privado. Escribe el código que te han dado. Se recordará en este navegador.</p>
        </div>
        <input className="input" type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label="Código de acceso" />
        {err && <Banner tone="error" title={err} />}
        <button className="btn-primary w-full" disabled={busy || !code.trim()}>{busy ? <Spinner /> : null} Entrar</button>
      </form>
    </div>
  );
}
