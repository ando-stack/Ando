import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";

const COLORES = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#f43f5e"];

/** Confeti animado para celebrar (respeta "reducir movimiento" vía CSS). */
export function Celebracion({ activa, mensaje }: { activa: boolean; mensaje?: string }) {
  const piezas = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        retraso: Math.random() * 0.4,
        giro: Math.random() * 720 - 360,
        color: COLORES[i % COLORES.length],
        tam: 6 + Math.random() * 8,
        deriva: (Math.random() - 0.5) * 30,
      })),
    // nuevas piezas cada vez que se activa
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activa],
  );
  return (
    <AnimatePresence>
      {activa && (
        <motion.div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" initial={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden={!mensaje}>
          {piezas.map((p) => (
            <motion.span
              key={p.id}
              className="absolute top-0 block rounded-sm"
              style={{ left: `${p.x}%`, width: p.tam, height: p.tam * 0.6, background: p.color }}
              initial={{ y: -20, rotate: 0, x: 0 }}
              animate={{ y: "105vh", rotate: p.giro, x: `${p.deriva}vw` }}
              transition={{ duration: 2.2 + Math.random(), delay: p.retraso, ease: "easeIn" }}
            />
          ))}
          {mensaje && (
            <motion.div className="absolute inset-x-0 top-1/3 flex justify-center px-6" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
              <div className="rounded-3xl bg-white px-6 py-4 text-center text-xl font-extrabold text-marca-700 shadow-flota" role="status">
                {mensaje}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
