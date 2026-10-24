import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { useExamen } from "../hooks/useExamen";
import { useTrabajo } from "../hooks/useTrabajo";
import { puedeUsarIA, useAuth } from "../hooks/useAuth";
import { hoyISO } from "../lib/fechas";
import type { AnalisisFeynman, Fuente } from "../lib/tipos";
import { ListaCitada, Markdown, VisorFragmento } from "../components/Contenido";
import { Aviso, Cargando, Citas, EstadoTrabajo, SelectorTema } from "../components/ui";

interface Mensaje {
  id: string;
  rol: "usuario" | "tutor";
  contenido: string;
  nivel: string | null;
  fuentes: Fuente[];
  created_at: string;
}

const NIVELES = [
  { v: "sencillo", t: "Sencillo" },
  { v: "normal", t: "Normal" },
  { v: "avanzado", t: "Avanzado" },
];

export default function Tutor() {
  const [modo, setModo] = useState<"tutor" | "feynman">("tutor");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
        <button type="button" onClick={() => setModo("tutor")} className={`rounded-xl py-2 text-sm font-bold ${modo === "tutor" ? "bg-marca-600 text-white" : "text-slate-600"}`}>💬 Pregunta tus dudas</button>
        <button type="button" onClick={() => setModo("feynman")} className={`rounded-xl py-2 text-sm font-bold ${modo === "feynman" ? "bg-marca-600 text-white" : "text-slate-600"}`}>🗣️ Explícalo tú</button>
      </div>
      {modo === "tutor" ? <Chat /> : <Feynman />}
    </div>
  );
}

function Chat() {
  const { examen } = useExamen();
  const { perfil } = useAuth();
  const [texto, setTexto] = useState("");
  const [nivel, setNivel] = useState("normal");
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const { datos, cargando, error, recargar } = useDatos(async () => ((await supabase.from("tutor_messages").select("*").eq("exam_id", examen.id).order("created_at").limit(200).then(sb)) ?? []) as Mensaje[], [examen.id]);
  const t = useTrabajo(() => void recargar(true));
  const mensajes = datos ?? [];

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes.length, t.enCurso]);

  async function enviar() {
    const m = texto.trim();
    if (!m || t.enCurso) return;
    setTexto("");
    const id = await t.lanzar("tutor", examen.id, { mensaje: m, nivel });
    if (id) void recargar(true);
    else setTexto(m);
  }

  if (!puedeUsarIA(perfil)) return <Aviso tipo="info">Para usar el tutor necesitas el permiso de IA (en tu perfil).</Aviso>;
  if (cargando && !datos) return <Cargando />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;

  return (
    <div className="flex flex-col gap-3">
      <div className="tarjeta min-h-[45vh] space-y-3">
        {mensajes.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            <p className="text-4xl">🤓</p>
            <p className="mt-2 font-semibold text-slate-700">Soy tu tutor para {examen.asignatura}</p>
            <p>Pregúntame lo que no entiendas. Te respondo con tus apuntes, paso a paso.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {["Explícame el tema 1 como si tuviera 10 años", "¿Qué es lo más importante para el examen?", "Hazme una pregunta para comprobar si lo entiendo"].map((s) => (
                <button key={s} type="button" className="chip bg-marca-50 text-marca-700" onClick={() => setTexto(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {mensajes.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={`flex ${m.rol === "usuario" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-3xl px-4 py-2.5 ${m.rol === "usuario" ? "rounded-br-lg bg-gradient-to-r from-marca-600 to-fuchsia-500 text-white" : "rounded-bl-lg bg-slate-50 ring-1 ring-slate-100"}`}>
                {m.rol === "usuario" ? <p className="whitespace-pre-wrap text-[15px]">{m.contenido}</p> : (
                  <>
                    <Markdown texto={m.contenido} />
                    {m.fuentes.length > 0 && <div className="mt-2"><Citas fuentes={m.fuentes} alAbrir={setFuente} /></div>}
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {t.enCurso && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-3xl rounded-bl-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-100" aria-label="El tutor está escribiendo">
              {[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-marca-400" animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} />)}
              <span className="ml-2 text-xs text-slate-500">{t.trabajo?.mensaje}</span>
            </div>
          </div>
        )}
        <div ref={fin} />
      </div>
      {t.error && <Aviso tipo={/límite/i.test(t.error) ? "aviso" : "error"}>{t.error}</Aviso>}
      <div className="sticky bottom-20 space-y-2 rounded-3xl bg-white p-2 shadow-flota ring-1 ring-marca-100 sm:bottom-4">
        <div className="flex gap-1">
          {NIVELES.map((n) => (
            <button key={n.v} type="button" onClick={() => setNivel(n.v)} className={`chip ${nivel === n.v ? "bg-marca-600 text-white" : "bg-slate-100 text-slate-600"}`}>{n.t}</button>
          ))}
          <span className="ml-auto self-center text-[11px] text-slate-400">Nivel de explicación</span>
        </div>
        <div className="flex gap-2">
          <textarea className="campo min-h-12 resize-none py-2.5" rows={1} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} placeholder="Escribe tu duda…" maxLength={4000} aria-label="Tu pregunta" />
          <button type="button" className="boton-primario px-4" disabled={!texto.trim() || t.enCurso} onClick={enviar} aria-label="Enviar">➤</button>
        </div>
      </div>
      <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => setFuente(null)} />
    </div>
  );
}

type Reconocimiento = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: () => void };

function Feynman() {
  const { examen, temas } = useExamen();
  const { perfil } = useAuth();
  const [tema, setTema] = useState<string | null>(temas[0]?.id ?? null);
  const [texto, setTexto] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [analisis, setAnalisis] = useState<AnalisisFeynman | null>(null);
  const rec = useRef<Reconocimiento | null>(null);
  const t = useTrabajo(async (j) => {
    const id = j.resultado?.feynman_id as string | undefined;
    if (!id) return;
    const { data } = await supabase.from("feynman_attempts").select("analisis").eq("id", id).single();
    setAnalisis((data?.analisis as AnalisisFeynman) ?? null);
    if (perfil) await supabase.from("study_sessions").insert({ user_id: perfil.id, exam_id: examen.id, fecha: hoyISO(), tipo: "feynman", minutos: 10 });
  });
  const ctor = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Reconocimiento }).webkitSpeechRecognition) : undefined;

  function dictar() {
    if (!ctor) return;
    if (escuchando) {
      rec.current?.stop();
      return;
    }
    const r = new ctor();
    r.lang = "es-ES";
    r.continuous = true;
    r.interimResults = false;
    const base = texto;
    let acumulado = "";
    r.onresult = (e) => {
      acumulado = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      setTexto(`${base}${base ? " " : ""}${acumulado}`.trim());
    };
    r.onend = () => setEscuchando(false);
    r.onerror = () => setEscuchando(false);
    rec.current = r;
    setEscuchando(true);
    r.start();
  }

  if (!puedeUsarIA(perfil)) return <Aviso tipo="info">Para usar esta función necesitas el permiso de IA (en tu perfil).</Aviso>;
  return (
    <div className="space-y-4">
      <div className="tarjeta space-y-3">
        <h2 className="font-bold">Técnica Feynman: explícalo con tus palabras</h2>
        <p className="text-sm text-slate-500">Explica el tema como si se lo contaras a un amigo que no lo ha estudiado. Después comparamos tu explicación con tus apuntes y te decimos qué falta y qué no está bien.</p>
        <SelectorTema temas={temas} valor={tema} alCambiar={setTema} />
        <textarea className="campo min-h-48" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Empieza por la idea principal…" maxLength={12000} aria-label="Tu explicación" />
        <div className="flex flex-wrap items-center gap-2">
          {ctor && (
            <button type="button" className={escuchando ? "boton bg-rose-500 text-white" : "boton-secundario"} onClick={dictar}>
              {escuchando ? "⏹ Parar" : "🎤 Dictar"}
            </button>
          )}
          <span className="text-xs text-slate-400">{texto.trim().split(/\s+/).filter(Boolean).length} palabras</span>
          <button type="button" className="boton-primario ml-auto" disabled={texto.trim().length < 40 || t.enCurso} onClick={() => { setAnalisis(null); void t.lanzar("feynman", examen.id, { topic_id: tema, explicacion: texto }); }}>
            {t.enCurso ? "Analizando…" : "Analizar mi explicación"}
          </button>
        </div>
        {escuchando && <p className="text-xs text-rose-600">● Escuchando… (el dictado lo hace tu navegador)</p>}
      </div>
      <EstadoTrabajo trabajo={t.trabajo} error={t.error} />
      {analisis && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="tarjeta bg-gradient-to-br from-marca-50 to-white"><p className="text-slate-800">{analisis.valoracion}</p></div>
          {analisis.bien_explicado.length > 0 && <Bloque titulo="✅ Bien explicado" items={analisis.bien_explicado} />}
          {analisis.lagunas.length > 0 && <Bloque titulo="🕳️ Te faltó mencionar" items={analisis.lagunas} />}
          {analisis.errores.length > 0 && (
            <div className="tarjeta space-y-2">
              <h3 className="font-bold">❌ Para corregir</h3>
              {analisis.errores.map((e, i) => (
                <div key={i} className="rounded-2xl bg-rose-50 p-3 text-sm">
                  <p className="text-rose-800">Dijiste: «{e.lo_que_dijiste}»</p>
                  <Markdown texto={`**Según tus apuntes:** ${e.correccion}`} />
                  <Citas fuentes={e.fuentes} />
                </div>
              ))}
            </div>
          )}
          {analisis.confuso.length > 0 && <Bloque titulo="🌀 Poco claro" items={analisis.confuso} />}
          <div className="tarjeta"><p className="text-sm font-semibold text-marca-800">👉 {analisis.siguiente_paso}</p></div>
        </motion.div>
      )}
    </div>
  );
}

function Bloque({ titulo, items }: { titulo: string; items: AnalisisFeynman["lagunas"] }) {
  const { examen } = useExamen();
  return (
    <div className="tarjeta space-y-2">
      <h3 className="font-bold">{titulo}</h3>
      <ListaCitada items={items} examId={examen.id} />
    </div>
  );
}
