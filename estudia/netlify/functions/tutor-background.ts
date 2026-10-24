// Tutor IA basado en los apuntes del examen. La lanza /api/trabajos.
import { ejecutarTrabajo } from "./_shared/trabajos";
import { tutor } from "./_shared/tareas/tutor";

export default async (req: Request) => ejecutarTrabajo(req, { tutor });
