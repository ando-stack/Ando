import { useCallback, useEffect, useRef, useState } from "react";
import { mensajeError } from "../lib/api";

/** Carga datos asíncronos con estado de carga, error y recarga. */
export function useDatos<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const ref = useRef(cargar);
  ref.current = cargar;

  const recargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const d = await ref.current();
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { datos, error, cargando, recargar, setDatos };
}

/** Lanza un error de Supabase si lo hay; devuelve los datos. */
export function sb<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data as T;
}
