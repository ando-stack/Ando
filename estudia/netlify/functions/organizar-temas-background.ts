// Organización por temas, indexado (pgvector) y actualización de lo generado. La lanza /api/trabajos.
import { ejecutarTrabajo } from "./_shared/trabajos";
import { organizarTemas } from "./_shared/tareas/lectura";

export default async (req: Request) => ejecutarTrabajo(req, { organizar_temas: organizarTemas });
