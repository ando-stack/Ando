// Botón para generar material con IA, con progreso y mensajes de error claros.
import { useTrabajo } from "../hooks/useTrabajo";
import { puedeUsarIA, useAuth } from "../hooks/useAuth";
import type { TipoTrabajo } from "../lib/tipos";
import { EstadoTrabajo } from "./ui";

export function BotonGenerar({
  tipo,
  examId,
  parametros = {},
  texto,
  alTerminar,
  secundario = false,
}: {
  tipo: TipoTrabajo;
  examId: string;
  parametros?: Record<string, unknown>;
  texto: string;
  alTerminar: (resultado: Record<string, unknown> | null) => void;
  secundario?: boolean;
}) {
  const { perfil } = useAuth();
  const { trabajo, error, enCurso, lanzar } = useTrabajo((t) => alTerminar(t.resultado));
  const permitido = puedeUsarIA(perfil);
  return (
    <div className="space-y-3">
      <button type="button" className={secundario ? "boton-secundario" : "boton-primario"} disabled={enCurso || !permitido} onClick={() => lanzar(tipo, examId, parametros)} title={permitido ? undefined : "Necesitas el permiso para usar la IA (perfil)"}>
        {enCurso ? "Generando…" : texto}
      </button>
      <EstadoTrabajo trabajo={trabajo} error={error} />
    </div>
  );
}
