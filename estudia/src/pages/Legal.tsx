// Política de privacidad y términos (borradores de docs/legal.md, pendientes de revisión profesional).
import { Link } from "react-router-dom";
import legal from "../../docs/legal.md?raw";
import { Markdown } from "../components/Contenido";

function seccion(md: string, titulo: string): string {
  const inicio = md.indexOf(`## ${titulo}`);
  if (inicio < 0) return "";
  const resto = md.slice(inicio);
  const fin = resto.indexOf("\n## ", 4);
  return fin > 0 ? resto.slice(0, fin) : resto;
}

export default function Legal({ tipo }: { tipo: "privacidad" | "terminos" }) {
  const texto = seccion(legal, tipo === "privacidad" ? "3. Borrador de POLÍTICA DE PRIVACIDAD" : "4. Borrador de TÉRMINOS DE USO");
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="boton-fantasma mb-4 px-2">← Volver</Link>
      <div className="tarjeta">
        <p className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Borrador pendiente de revisión por un profesional antes de la publicación definitiva.</p>
        <Markdown texto={texto.replace(/^## \d\. Borrador de /, "## ")} />
      </div>
    </div>
  );
}
