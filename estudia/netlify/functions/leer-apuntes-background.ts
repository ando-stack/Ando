// Lectura de fotos y PDF con visión (hasta 15 min). La lanza /api/trabajos.
import { ejecutarTrabajo } from "./_shared/trabajos";
import { leerApuntes } from "./_shared/tareas/lectura";

export default async (req: Request) => ejecutarTrabajo(req, { leer_apuntes: leerApuntes });
