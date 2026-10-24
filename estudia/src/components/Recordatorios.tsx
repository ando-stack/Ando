// Recordatorios opcionales del plan del día (notificaciones del navegador). Nunca entre las 22:00 y las 8:00.
import { useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { hoyISO } from "../lib/fechas";
import type { DiaPlan } from "../lib/tipos";

export const HORA_MIN = 8;
export const HORA_MAX = 22;

export function horaPermitida(h: number, m = 0): boolean {
  const minutos = h * 60 + m;
  return minutos >= HORA_MIN * 60 && minutos < HORA_MAX * 60;
}

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function guardar(clave: string, v: string) {
  try {
    localStorage.setItem(clave, v);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

async function tareasDeHoy(): Promise<number> {
  const hoy = hoyISO();
  const { data: planes } = await supabase.from("study_plans").select("exam_id, dias");
  const { data: hechas } = await supabase.from("study_sessions").select("tarea_id").eq("fecha", hoy);
  const ids = new Set((hechas ?? []).map((h) => h.tarea_id));
  return (planes ?? []).reduce((a, p) => a + ((p.dias as DiaPlan[]).find((d) => d.fecha === hoy)?.tareas.filter((t) => !ids.has(t.id)).length ?? 0), 0);
}

export function Recordatorios() {
  const { perfil } = useAuth();
  const n = perfil?.preferencias?.notificaciones;
  useEffect(() => {
    if (!n?.activas || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const [h, m] = (n.hora || "17:30").split(":").map(Number);
    if (!horaPermitida(h, m)) return;
    const clave = "estudia:recordatorio";
    const programar = () => {
      const ahora = new Date();
      const objetivo = new Date();
      objetivo.setHours(h, m, 0, 0);
      const yaHoy = leer(clave) === hoyISO();
      if (yaHoy) return null;
      const espera = objetivo.getTime() - ahora.getTime();
      const disparar = async () => {
        if (!horaPermitida(new Date().getHours(), new Date().getMinutes()) || leer(clave) === hoyISO()) return;
        const pendientes = await tareasDeHoy();
        guardar(clave, hoyISO());
        if (pendientes > 0) {
          new Notification("Estudia · tu plan de hoy", { body: `Tienes ${pendientes} tarea${pendientes === 1 ? "" : "s"} para hoy. ¡Con un ratito ya avanzas!`, icon: "/icono.svg", tag: "plan-diario" });
        }
      };
      if (espera <= 0) {
        void disparar();
        return null;
      }
      return window.setTimeout(disparar, espera);
    };
    const t = programar();
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [n?.activas, n?.hora]);
  return null;
}
