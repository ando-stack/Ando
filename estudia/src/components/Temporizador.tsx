// Temporizador de concentración (Pomodoro configurable) y temporizador de examen.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { hoyISO } from "../lib/fechas";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "./ui";

type Fase = "trabajo" | "descanso" | "descanso_largo";

const formato = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Anillo({ progreso, children, tam = 168 }: { progreso: number; children: React.ReactNode; tam?: number }) {
  const r = tam / 2 - 10;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: tam, height: tam }}>
      <svg width={tam} height={tam} className="-rotate-90">
        <circle cx={tam / 2} cy={tam / 2} r={r} stroke="#ede9fe" strokeWidth="10" fill="none" />
        <motion.circle cx={tam / 2} cy={tam / 2} r={r} stroke="url(#grad-pomodoro)" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - progreso) }} transition={{ ease: "linear", duration: 0.5 }} />
        <defs>
          <linearGradient id="grad-pomodoro" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Pomodoro({ examId }: { examId?: string }) {
  const { perfil, sesion } = useAuth();
  const aviso = useToast();
  const cfg = perfil?.preferencias?.pomodoro ?? { trabajo: 25, descanso: 5, descanso_largo: 15, ciclos: 4 };
  const [abierto, setAbierto] = useState(false);
  const [fase, setFase] = useState<Fase>("trabajo");
  const [ciclo, setCiclo] = useState(1);
  const [fin, setFin] = useState<number | null>(null); // marca de tiempo de fin
  const [restante, setRestante] = useState(cfg.trabajo * 60);
  const [, forzar] = useState(0);
  const duracion = (f: Fase) => (f === "trabajo" ? cfg.trabajo : f === "descanso" ? cfg.descanso : cfg.descanso_largo) * 60;
  const ref = useRef({ fase, ciclo });
  ref.current = { fase, ciclo };

  useEffect(() => {
    if (!fin) return;
    const t = window.setInterval(() => {
      const s = Math.max(0, (fin - Date.now()) / 1000);
      setRestante(s);
      forzar((x) => x + 1);
      if (s <= 0) {
        window.clearInterval(t);
        void terminarFase();
      }
    }, 500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fin]);

  async function terminarFase() {
    const { fase: f, ciclo: c } = ref.current;
    navigator.vibrate?.([200, 100, 200]);
    if (f === "trabajo") {
      if (sesion) {
        await supabase.from("study_sessions").insert({ user_id: sesion.user.id, exam_id: examId ?? null, fecha: hoyISO(), tipo: "pomodoro", minutos: cfg.trabajo });
      }
      const largo = c % cfg.ciclos === 0;
      aviso(largo ? `¡${cfg.ciclos} bloques completados! Tómate un descanso largo.` : "¡Bloque completado! Descansa un poco: estírate, bebe agua.", "exito");
      const siguiente: Fase = largo ? "descanso_largo" : "descanso";
      setFase(siguiente);
      setRestante(duracion(siguiente));
    } else {
      aviso("¡A por el siguiente bloque!", "info");
      setFase("trabajo");
      setCiclo(c + 1);
      setRestante(duracion("trabajo"));
    }
    setFin(null);
  }

  const corriendo = fin !== null;
  const total = duracion(fase);
  const etiqueta = fase === "trabajo" ? "Concentración" : fase === "descanso" ? "Descanso" : "Descanso largo";

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setAbierto(true)}
        className={`fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold shadow-flota sm:bottom-6 ${corriendo ? "bg-gradient-to-r from-marca-600 to-fuchsia-500 text-white" : "bg-white text-marca-700 ring-1 ring-marca-200"}`}
        whileTap={{ scale: 0.94 }}
        aria-label="Abrir el temporizador de concentración"
      >
        <span aria-hidden>⏱️</span>
        {corriendo ? <span className="tabular-nums">{formato(restante)}</span> : "Pomodoro"}
      </motion.button>
      <AnimatePresence>
        {abierto && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAbierto(false)}>
            <motion.div
              role="dialog"
              aria-label="Temporizador de concentración"
              className="w-full max-w-sm rounded-t-3xl bg-white p-6 text-center shadow-flota sm:rounded-3xl"
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-bold uppercase tracking-wide text-marca-600">
                {etiqueta} · bloque {((ciclo - 1) % cfg.ciclos) + 1}/{cfg.ciclos}
              </p>
              <div className="my-4 flex justify-center">
                <Anillo progreso={1 - restante / total}>
                  <span className="text-4xl font-extrabold tabular-nums text-slate-900">{formato(restante)}</span>
                  <span className="text-xs text-slate-500">{cfg.trabajo} + {cfg.descanso} min</span>
                </Anillo>
              </div>
              <div className="flex justify-center gap-2">
                {corriendo ? (
                  <button type="button" className="boton-secundario" onClick={() => setFin(null)}>
                    Pausar
                  </button>
                ) : (
                  <button type="button" className="boton-primario px-6" onClick={() => setFin(Date.now() + restante * 1000)}>
                    {restante < total ? "Continuar" : "Empezar"}
                  </button>
                )}
                <button
                  type="button"
                  className="boton-fantasma"
                  onClick={() => {
                    setFin(null);
                    setFase("trabajo");
                    setRestante(duracion("trabajo"));
                  }}
                >
                  Reiniciar
                </button>
              </div>
              <p className="mt-4 text-xs text-slate-500">Puedes cambiar los tiempos en tu perfil. Las pausas cortas ayudan a mantener la concentración.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Temporizador regresivo para exámenes de práctica. */
export function TemporizadorExamen({ inicio, minutos, alAcabar }: { inicio: string; minutos: number; alAcabar: () => void }) {
  const fin = new Date(inicio).getTime() + minutos * 60_000;
  const [restante, setRestante] = useState(() => Math.max(0, (fin - Date.now()) / 1000));
  const avisado = useRef(false);
  const cb = useRef(alAcabar);
  cb.current = alAcabar;
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = Math.max(0, (fin - Date.now()) / 1000);
      setRestante(s);
      if (s <= 0 && !avisado.current) {
        avisado.current = true;
        cb.current();
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [fin]);
  const poco = restante < 300;
  return (
    <div className={`chip px-3 py-1.5 text-sm tabular-nums ${poco ? "animate-pulse bg-rose-100 text-rose-700" : "bg-white/90 text-marca-700"}`} role="timer" aria-live={poco ? "polite" : "off"}>
      ⏳ {restante >= 3600 ? `${Math.floor(restante / 3600)}:` : ""}
      {formato(restante % 3600)}
    </div>
  );
}
