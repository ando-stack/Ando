import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { lanzarTrabajo, mensajeError } from "../lib/api";
import type { TipoTrabajo, TrabajoIA } from "../lib/tipos";

/**
 * Lanza un trabajo de IA y sigue su progreso (consulta ai_jobs cada 1,5 s).
 * Llama a `alTerminar` cuando acaba bien.
 */
export function useTrabajo(alTerminar?: (t: TrabajoIA) => void) {
  const [trabajo, setTrabajo] = useState<TrabajoIA | null>(null);
  const [error, setError] = useState<string | null>(null);
  const temporizador = useRef<number | null>(null);
  const cb = useRef(alTerminar);
  cb.current = alTerminar;

  const parar = () => {
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = null;
  };

  const seguir = useCallback((id: string) => {
    parar();
    const consultar = async () => {
      const { data } = await supabase.from("ai_jobs").select("id, tipo, estado, progreso, mensaje, resultado, error, created_at").eq("id", id).maybeSingle();
      if (data) {
        setTrabajo(data as TrabajoIA);
        if (data.estado === "completado") {
          cb.current?.(data as TrabajoIA);
          return;
        }
        if (data.estado === "error") {
          setError(data.error ?? "La tarea ha fallado.");
          return;
        }
      }
      temporizador.current = window.setTimeout(consultar, 1500);
    };
    void consultar();
  }, []);

  useEffect(() => parar, []);

  const lanzar = useCallback(
    async (tipo: TipoTrabajo, examId: string, parametros: Record<string, unknown> = {}) => {
      setError(null);
      setTrabajo({ id: "", tipo, estado: "pendiente", progreso: 0, mensaje: "Enviando…", resultado: null, error: null, created_at: new Date().toISOString() });
      try {
        const { job_id } = await lanzarTrabajo(tipo, examId, parametros);
        seguir(job_id);
        return job_id;
      } catch (e) {
        setTrabajo(null);
        setError(mensajeError(e));
        return null;
      }
    },
    [seguir],
  );

  const enCurso = Boolean(trabajo && (trabajo.estado === "pendiente" || trabajo.estado === "en_curso"));
  return { trabajo, error, enCurso, lanzar, seguir, limpiar: () => { setTrabajo(null); setError(null); } };
}
