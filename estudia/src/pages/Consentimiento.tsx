// Página pública para que el padre, madre o tutor dé (o deniegue) su consentimiento.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, mensajeError } from "../lib/api";
import { Aviso, Cargando } from "../components/ui";

export default function Consentimiento() {
  const { token = "" } = useParams();
  const [info, setInfo] = useState<{ nombre: string; version: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [relacion, setRelacion] = useState("");
  const [cuenta, setCuenta] = useState(false);
  const [ia, setIa] = useState(false);
  const [hecho, setHecho] = useState<"si" | "no" | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ nombre: string; version: string }>("consentimiento", { body: { accion: "ver", token }, sinAuth: true }).then(setInfo).catch((e) => setError(mensajeError(e)));
  }, [token]);

  async function responder(acepta: boolean) {
    setEnviando(true);
    setError(null);
    try {
      await api("consentimiento", { body: acepta ? { accion: "confirmar", token, nombre, relacion, acepta_cuenta: cuenta, acepta_ia: ia } : { accion: "denegar", token }, sinAuth: true });
      setHecho(acepta ? "si" : "no");
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-marca-100 via-fondo to-fuchsia-100 px-4 py-10">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="text-center">
          <img src="/icono.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-2 text-2xl font-extrabold">Permiso para usar Estudia</h1>
        </div>
        {hecho ? (
          <Aviso tipo={hecho === "si" ? "exito" : "info"} titulo={hecho === "si" ? "¡Gracias! Permiso registrado" : "Solicitud rechazada"}>
            {hecho === "si" ? "Ya puede usar Estudia. Puede retirar el permiso cuando quiera escribiendo al correo de privacidad o borrando la cuenta desde el perfil del menor." : "No se tratarán apuntes ni se usará la IA con esta cuenta."}
          </Aviso>
        ) : error && !info ? (
          <Aviso tipo="error">{error}</Aviso>
        ) : !info ? (
          <Cargando />
        ) : (
          <div className="tarjeta space-y-4 text-sm leading-relaxed text-slate-700">
            <p><strong>{info.nombre}</strong> quiere usar Estudia, una web para preparar exámenes a partir de sus propios apuntes con ayuda de inteligencia artificial. Como tiene menos de 14 años, necesitamos el consentimiento de su padre, madre o tutor legal (art. 8 del RGPD y art. 7 de la LOPDGDD).</p>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="font-bold text-slate-900">Qué datos se tratan y para qué</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Correo, nombre o apodo y fecha de nacimiento del menor.</li>
                <li>Fotos, PDF y textos de sus apuntes y el material de estudio generado (resúmenes, tarjetas, tests, plan).</li>
                <li>Los apuntes se envían a un proveedor de IA (Anthropic) solo para generar ese material.</li>
                <li>Todo es privado: nadie más puede verlo. No hay publicidad ni se venden datos.</li>
                <li>Se puede exportar y borrar todo en cualquier momento.</li>
              </ul>
              <p className="mt-2"><Link to="/privacidad" className="font-semibold text-marca-700 underline" target="_blank">Política de privacidad completa</Link></p>
            </div>
            <div>
              <label className="etiqueta" htmlFor="n">Su nombre y apellidos</label>
              <input id="n" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label className="etiqueta" htmlFor="r">Relación con el menor</label>
              <select id="r" className="campo" value={relacion} onChange={(e) => setRelacion(e.target.value)}>
                <option value="">Elija una opción</option>
                <option value="madre">Madre</option>
                <option value="padre">Padre</option>
                <option value="tutor_legal">Tutor/a legal</option>
              </select>
            </div>
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={cuenta} onChange={(e) => setCuenta(e.target.checked)} />
              <span>Declaro que ejerzo la patria potestad o tutela del menor y consiento que use Estudia según la política de privacidad (versión {info.version}).</span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={ia} onChange={(e) => setIa(e.target.checked)} />
              <span>Consiento que sus apuntes se procesen con inteligencia artificial para generar su material de estudio.</span>
            </label>
            {error && <Aviso tipo="error">{error}</Aviso>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="boton-fantasma" disabled={enviando} onClick={() => responder(false)}>No doy mi permiso</button>
              <button type="button" className="boton-primario" disabled={enviando || !cuenta || nombre.trim().length < 3 || !relacion} onClick={() => responder(true)}>Dar mi permiso</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
