// Corrección de exámenes de práctica con rúbrica y análisis Feynman. La lanza /api/trabajos.
import { ejecutarTrabajo } from "./_shared/trabajos";
import { corregirSimulacro, feynman } from "./_shared/tareas/correccion";

export default async (req: Request) => ejecutarTrabajo(req, { corregir_simulacro: corregirSimulacro, feynman });
