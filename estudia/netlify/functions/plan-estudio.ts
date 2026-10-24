// POST /api/plan → genera o reajusta el plan de estudio día a día de un examen (sin IA).

import type { Config } from "@netlify/functions";
import { ErrorUsuario, exigirExamen, json, leerJSON, respuestaError, usuarioDesdePeticion } from "./_shared/base";
import { recalcularPlan } from "./_shared/plan-servidor";

export default async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const u = await usuarioDesdePeticion(req);
    const { exam_id, hoy } = await leerJSON<{ exam_id: string; hoy?: string }>(req);
    if (!exam_id) throw new ErrorUsuario("Falta el examen.");
    await exigirExamen(u.id, exam_id);
    // "hoy" lo envía el navegador para respetar su zona horaria
    const dia = typeof hoy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(hoy) ? hoy : undefined;
    const plan = await recalcularPlan(u.id, exam_id, dia);
    return json({ plan });
  } catch (e) {
    return respuestaError(e);
  }
};

export const config: Config = { path: "/api/plan" };
