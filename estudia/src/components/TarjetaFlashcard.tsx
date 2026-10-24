// Tarjeta de flashcard que se gira con animación 3D.
import { motion } from "motion/react";
import type { Flashcard } from "../lib/tipos";
import { Markdown } from "./Contenido";
import { Citas } from "./ui";
import type { Fuente } from "../lib/tipos";

const ETIQUETA: Record<string, string> = { pregunta: "Pregunta", huecos: "Completa", definicion: "Definición", formula: "Fórmula", fecha: "Fecha" };

export function TarjetaFlashcard({ tarjeta, girada, alGirar, alVerFuente }: { tarjeta: Flashcard; girada: boolean; alGirar: () => void; alVerFuente: (f: Fuente) => void }) {
  return (
    <div className="mx-auto w-full max-w-lg" style={{ perspective: 1200 }}>
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={girada ? "Respuesta (toca para ver la pregunta)" : "Pregunta (toca para ver la respuesta)"}
        onClick={alGirar}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), alGirar())}
        className="relative h-72 w-full cursor-pointer sm:h-80"
        animate={{ rotateY: girada ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <div className="absolute inset-0 flex flex-col rounded-3xl bg-white p-5 shadow-flota ring-1 ring-marca-100" style={{ backfaceVisibility: "hidden" }}>
          <span className="chip self-start bg-marca-50 text-marca-700">{ETIQUETA[tarjeta.tipo] ?? "Tarjeta"}</span>
          <div className="flex flex-1 items-center justify-center overflow-auto text-center text-lg">
            <Markdown texto={tarjeta.anverso} className="text-lg" />
          </div>
          <p className="text-center text-xs text-slate-400">Piensa la respuesta y toca para girar</p>
        </div>
        <div className="absolute inset-0 flex flex-col rounded-3xl bg-gradient-to-br from-marca-50 to-fuchsia-50 p-5 shadow-flota ring-1 ring-marca-200" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <span className="chip self-start bg-white text-marca-700">Respuesta</span>
          <div className="flex flex-1 items-center justify-center overflow-auto text-center">
            <Markdown texto={tarjeta.reverso} className="text-lg" />
          </div>
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Citas fuentes={tarjeta.fuentes} ampliacion={tarjeta.ampliacion} alAbrir={alVerFuente} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
