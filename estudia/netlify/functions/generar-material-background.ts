// Generación de resúmenes, esquemas, flashcards, tests y exámenes de práctica. La lanza /api/trabajos.
import { ejecutarTrabajo } from "./_shared/trabajos";
import { generarMaterial } from "./_shared/tareas/materiales";

export default async (req: Request) =>
  ejecutarTrabajo(req, {
    resumen: generarMaterial,
    esquema: generarMaterial,
    flashcards: generarMaterial,
    test: generarMaterial,
    simulacro: generarMaterial,
  });
