import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { mensajeError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { Aviso } from "../components/ui";
import { VERSION_POLITICA, edadDesde } from "../lib/consentimiento";


export default function Login() {
  const { sesion } = useAuth();
  const loc = useLocation();
  const [modo, setModo] = useState<"entrar" | "registro" | "recuperar">("entrar");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [nacimiento, setNacimiento] = useState("");
  const [aceptaPrivacidad, setAceptaPrivacidad] = useState(false);
  const [aceptaIA, setAceptaIA] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  if (sesion) return <Navigate to={(loc.state as { desde?: string } | null)?.desde ?? "/"} replace />;
  const edad = edadDesde(nacimiento);
  const menor = edad !== null && edad < 14;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setEnviando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
        if (error) throw error;
      } else if (modo === "recuperar") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/perfil` });
        if (error) throw error;
        setMensaje("Si existe una cuenta con ese correo, te hemos enviado un enlace para cambiar la contraseña.");
      } else {
        if (edad === null || edad < 6 || edad > 100) throw new Error("Revisa tu fecha de nacimiento.");
        if (clave.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
        if (!menor && !aceptaPrivacidad) throw new Error("Para crear la cuenta tienes que aceptar la política de privacidad y los términos.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password: clave,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              nombre: nombre.trim().slice(0, 80),
              fecha_nacimiento: nacimiento,
              acepta_privacidad: !menor && aceptaPrivacidad,
              acepta_ia: !menor && aceptaIA,
              version_politica: VERSION_POLITICA,
            },
          },
        });
        if (error) throw error;
        if (!data.session) setMensaje("¡Cuenta creada! Te hemos enviado un correo para confirmarla. Ábrelo y vuelve aquí para entrar.");
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-br from-marca-100 via-fondo to-fuchsia-100 px-4 py-10">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-6 text-center">
        <img src="/icono.svg" alt="" className="mx-auto h-16 w-16 drop-shadow-lg" />
        <h1 className="mt-3 text-3xl font-extrabold text-slate-900">Estudia</h1>
        <p className="mt-1 text-slate-600">Tus apuntes se convierten en tu plan para aprobar.</p>
      </motion.div>

      <motion.form layout onSubmit={enviar} className="tarjeta w-full max-w-md space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
          {(["entrar", "registro"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={modo === m} onClick={() => { setModo(m); setError(null); setMensaje(null); }} className={`relative rounded-xl py-2 text-sm font-bold ${modo === m ? "text-marca-700" : "text-slate-500"}`}>
              {modo === m && <motion.span layoutId="tab-login" className="absolute inset-0 rounded-xl bg-white shadow" />}
              <span className="relative">{m === "entrar" ? "Entrar" : "Crear cuenta"}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="popLayout">
          {modo === "registro" && (
            <motion.div key="nombre" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <label className="etiqueta" htmlFor="nombre">¿Cómo te llamamos?</label>
              <input id="nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre o un apodo" maxLength={80} autoComplete="nickname" />
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <label className="etiqueta" htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" required className="campo" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
        </div>
        {modo !== "recuperar" && (
          <div>
            <label className="etiqueta" htmlFor="clave">Contraseña</label>
            <input id="clave" type="password" required minLength={modo === "registro" ? 8 : undefined} className="campo" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === "registro" ? "new-password" : "current-password"} />
          </div>
        )}

        {modo === "registro" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            <div>
              <label className="etiqueta" htmlFor="nacimiento">Fecha de nacimiento</label>
              <input id="nacimiento" type="date" required className="campo" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              <p className="mt-1 text-xs text-slate-500">La pedimos para proteger tus datos según tu edad (la ley española exige permiso de tus padres por debajo de 14 años).</p>
            </div>
            {menor ? (
              <Aviso tipo="info" titulo="Necesitarás el permiso de tu padre, madre o tutor">
                Como tienes menos de 14 años, podrás crear tu cuenta, pero para subir apuntes y usar la IA te pediremos el correo de tu padre, madre o tutor para que dé su permiso.
              </Aviso>
            ) : (
              edad !== null && (
                <div className="space-y-2 text-sm">
                  <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={aceptaPrivacidad} onChange={(e) => setAceptaPrivacidad(e.target.checked)} />
                    <span>
                      He leído y acepto la <Link to="/privacidad" target="_blank" className="font-semibold text-marca-700 underline">política de privacidad</Link> y los <Link to="/terminos" target="_blank" className="font-semibold text-marca-700 underline">términos de uso</Link>.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={aceptaIA} onChange={(e) => setAceptaIA(e.target.checked)} />
                    <span>Acepto que mis apuntes se procesen con inteligencia artificial (proveedor: Anthropic) solo para crear mis materiales de estudio. Puedes cambiarlo después en tu perfil.</span>
                  </label>
                </div>
              )
            )}
          </motion.div>
        )}

        {error && <Aviso tipo="error">{error}</Aviso>}
        {mensaje && <Aviso tipo="exito">{mensaje}</Aviso>}

        <button type="submit" className="boton-primario w-full py-3 text-base" disabled={enviando}>
          {enviando ? "Un momento…" : modo === "entrar" ? "Entrar" : modo === "registro" ? "Crear mi cuenta" : "Enviar enlace"}
        </button>
        <div className="text-center text-sm">
          {modo === "entrar" ? (
            <button type="button" className="font-semibold text-marca-700" onClick={() => setModo("recuperar")}>¿Has olvidado la contraseña?</button>
          ) : modo === "recuperar" ? (
            <button type="button" className="font-semibold text-marca-700" onClick={() => setModo("entrar")}>Volver</button>
          ) : null}
        </div>
      </motion.form>
      <p className="mt-6 max-w-md text-center text-xs text-slate-500">
        Tus apuntes son privados: nadie más puede verlos. <Link to="/privacidad" className="underline">Privacidad</Link> · <Link to="/terminos" className="underline">Términos</Link>
      </p>
    </div>
  );
}
