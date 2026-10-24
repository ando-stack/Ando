import { createContext, useContext } from "react";
import type { Examen, Tema } from "../lib/tipos";

export interface CtxExamen {
  examen: Examen;
  temas: Tema[];
  recargar: () => Promise<void>;
}

export const ExamenCtx = createContext<CtxExamen | null>(null);

export function useExamen(): CtxExamen {
  const c = useContext(ExamenCtx);
  if (!c) throw new Error("useExamen fuera de un examen");
  return c;
}
