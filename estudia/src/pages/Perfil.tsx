import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api, descargarMisDatos, mensajeError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { VERSION_POLITICA, edadDesde } from "../lib/consentimiento";
import { horaPermitida } from "../components/Recordatorios";
import type { Perfil as TipoPerfil } from "../lib/tipos";
import { Aviso, BarraProgreso, Cargando, Modal, useToast } from "../components/ui";

type Uso = { uso: Record<string, { usados: number; limite: number }>; tokens: number; limite_tokens: number };
const NOMBRE_USO: Record<string, string> = { lectura: "Lectura de apuntes", generacion: "Materiales generados", correccion: "Correcciones", tutor: "Preguntas al tutor" };

export default function Perfil() {
  const { perfil, sesion, recargarPerfil, salir } = useAuth();
  const aviso = useToast();
  const navegar = useNavigate();
  const [nombre, setNombre] = useState(perfil?.nombre ?? "");
  const [prefs, setPrefs] = useState<TipoPerfil["preferencias"] | null>(perfil?.preferencias ?? null);
  const [tutorEmail, setTutorEmail] = useState(perfil?.tutor_email ?? "");
  const [aceptaPriv, setAceptaPriv] = useState(false);
  const [aceptaIA, setAceptaIA] = useState(true);
  const [uso, setUso] = useState<Uso | null>(null);
  const [borrar, setBorrar] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setNombre(perfil?.nombre ?? "");
    setPrefs(perfil?.preferencias ?? null);
    setTutorEmail(perfil?.tutor_email ?? "");
  }, [perfil]);
  useEffect(() => {
    api<Uso>("trabajos").then(setUso).catch(() => setUso(null));
  }, []);

  if (!perfil || !prefs) return <Cargando />;
  const edad = edadDesde(perfil.fecha_nacimiento);
  const menor = edad !== null && edad < 14;

  async function guardar(cambios: Partial<Pick<TipoPerfil, "nombre" | "preferencias">>) {
    const { error } = await supabase.from("profiles").update(cambios).eq("id", perfil!.id);
    if (error) return aviso(mensajeError(error), "error");
    await recargarPerfil();
    aviso("Guardado.", "exito");
  }

  async function pedirPermisoTutor() {
    setOcupado(true);
    try {
      const r = await api<{ via: string }>("consentimiento", { body: { accion: "solicitar", tutor_email: tutorEmail } });
      aviso(r.via === "email" ? "¡Enviado! Pide a tu padre, madre o tutor que revise su correo." : "Solicitud registrada (en este servidor de pruebas el correo no se envía; mira los registros).", "exito");
      await recargarPerfil();
    } catch (e) {
      aviso(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  async function aceptar(ia: boolean) {
    const { error } = await supabase.rpc("aceptar_consentimiento", { p_version: VERSION_POLITICA, p_ia: ia });
    if (error) return aviso(mensajeError(error), "error");
    await recargarPerfil();
    aviso(ia ? "¡Listo! Ya puedes subir apuntes y usar la IA." : "Guardado.", "exito");
  }

  async function retirarIA() {
    if (!window.confirm("¿Desactivar el uso de IA? Podrás seguir usando lo que ya tienes, pero no se leerán apuntes nuevos ni se generará material.")) return;
    const { error } = await supabase.rpc("retirar_consentimiento_ia");
    if (error) return aviso(mensajeError(error), "error");
    await recargarPerfil();
  }

  async function activarNotificaciones(activas: boolean) {
    if (activas && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return aviso("Tu navegador no ha permitido las notificaciones.", "aviso");
    }
    if (activas && typeof Notification === "undefined") return aviso("Este navegador no admite notificaciones.", "aviso");
    const nuevas = { ...prefs!, notificaciones: { ...prefs!.notificaciones, activas } };
    setPrefs(nuevas);
    await guardar({ preferencias: nuevas });
  }

  async function borrarCuenta() {
    setOcupado(true);
    try {
      await api("privacidad", { body: { confirmacion } });
      await supabase.auth.signOut();
      navegar("/login");
    } catch (e) {
      aviso(mensajeError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  const [h, m] = prefs.notificaciones.hora.split(":").map(Number);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-extrabold text-slate-900">Tu perfil</h1>

      <section className="tarjeta space-y-3">
        <h2 className="font-bold">Tus datos</h2>
        <div>
          <label className="etiqueta" htmlFor="nombre">Nombre o apodo</label>
          <div className="flex gap-2">
            <input id="nombre" className="campo" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
            <button type="button" className="boton-secundario" disabled={nombre === perfil.nombre} onClick={() => guardar({ nombre: nombre.trim() })}>Guardar</button>
          </div>
        </div>
        <p className="text-sm text-slate-600">Correo: {sesion?.user.email} · Edad: {edad ?? "—"} años</p>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-bold">Privacidad y permisos</h2>
        {perfil.consentimiento_estado === "pendiente_tutor" && (
          <>
            <Aviso tipo="info" titulo="Necesitamos el permiso de tu padre, madre o tutor">
              Como tienes menos de 14 años, la ley exige que un adulto responsable dé su consentimiento antes de que podamos guardar tus apuntes y usar la IA. Le enviaremos un correo con toda la información.
            </Aviso>
            <label className="etiqueta" htmlFor="tutor">Correo de tu padre, madre o tutor</label>
            <div className="flex gap-2">
              <input id="tutor" type="email" className="campo" value={tutorEmail} onChange={(e) => setTutorEmail(e.target.value)} placeholder="adulto@correo.es" />
              <button type="button" className="boton-primario" disabled={ocupado || !tutorEmail} onClick={pedirPermisoTutor}>Enviar</button>
            </div>
            {perfil.tutor_email && <p className="text-xs text-slate-500">Última solicitud enviada a {perfil.tutor_email}. Si no le llega, revisa la carpeta de spam o vuelve a enviarla.</p>}
          </>
        )}
        {perfil.consentimiento_estado === "pendiente" && !menor && (
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={aceptaPriv} onChange={(e) => setAceptaPriv(e.target.checked)} />
              <span>Acepto la <Link to="/privacidad" className="font-semibold text-marca-700 underline">política de privacidad</Link> y los <Link to="/terminos" className="font-semibold text-marca-700 underline">términos</Link>.</span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-marca-600" checked={aceptaIA} onChange={(e) => setAceptaIA(e.target.checked)} />
              <span>Acepto que mis apuntes se procesen con IA (Anthropic) solo para crear mis materiales.</span>
            </label>
            <button type="button" className="boton-primario" disabled={!aceptaPriv} onClick={() => aceptar(aceptaIA)}>Aceptar</button>
          </div>
        )}
        {perfil.consentimiento_estado === "concedido" && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
            <div>
              <p className="text-sm font-semibold">Uso de IA con mis apuntes</p>
              <p className="text-xs text-slate-500">{perfil.consentimiento_ia ? "Activado" : "Desactivado"}{menor ? " · lo autorizó tu tutor" : ""}</p>
            </div>
            {perfil.consentimiento_ia ? (
              <button type="button" className="boton-secundario" onClick={retirarIA}>Desactivar</button>
            ) : menor ? (
              <span className="text-xs text-slate-500">Para activarlo, tu tutor debe volver a autorizarlo.</span>
            ) : (
              <button type="button" className="boton-primario" onClick={() => aceptar(true)}>Activar</button>
            )}
          </div>
        )}
        <p className="text-xs text-slate-500">Tus apuntes son privados: solo tú puedes verlos. Nunca los compartimos ni los usamos para publicidad.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario" onClick={() => descargarMisDatos().catch((e) => aviso(mensajeError(e), "error"))}>⬇️ Exportar mis datos</button>
          <button type="button" className="boton bg-rose-50 text-rose-700 ring-1 ring-rose-200" onClick={() => setBorrar(true)}>🗑️ Borrar todos mis datos</button>
        </div>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-bold">Concentración (Pomodoro)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["trabajo", "Trabajo", 10, 60], ["descanso", "Descanso", 3, 20], ["descanso_largo", "Descanso largo", 10, 40], ["ciclos", "Bloques", 2, 6]] as const).map(([k, t, min, max]) => (
            <div key={k}>
              <label className="etiqueta" htmlFor={k}>{t}</label>
              <input id={k} type="number" className="campo" min={min} max={max} value={prefs.pomodoro[k]} onChange={(e) => setPrefs({ ...prefs, pomodoro: { ...prefs.pomodoro, [k]: Math.max(min, Math.min(max, Number(e.target.value) || min)) } })} />
            </div>
          ))}
        </div>
        <button type="button" className="boton-secundario" onClick={() => guardar({ preferencias: prefs })}>Guardar tiempos</button>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-bold">Recordatorios</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Avisarme del plan del día (notificación del navegador)</span>
          <input type="checkbox" className="h-6 w-6 accent-marca-600" checked={prefs.notificaciones.activas} onChange={(e) => activarNotificaciones(e.target.checked)} />
        </label>
        <div className="flex items-center gap-2">
          <label className="text-sm" htmlFor="hora">A las</label>
          <input id="hora" type="time" min="08:00" max="21:59" className="campo w-auto" value={prefs.notificaciones.hora} onChange={(e) => setPrefs({ ...prefs, notificaciones: { ...prefs.notificaciones, hora: e.target.value } })} />
          <button type="button" className="boton-secundario" disabled={!horaPermitida(h, m)} onClick={() => guardar({ preferencias: prefs })}>Guardar</button>
        </div>
        {!horaPermitida(h, m) && <p className="text-xs text-amber-700">Elige una hora entre las 8:00 y las 22:00: por la noche no enviamos avisos.</p>}
        <p className="text-xs text-slate-500">Funciona con la web abierta o instalada en el móvil. Nunca enviamos avisos entre las 22:00 y las 8:00.</p>
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="font-bold">Repetición espaciada</h2>
        <label className="etiqueta" htmlFor="ret">Retención deseada: {Math.round(prefs.retencion * 100)} %</label>
        <input id="ret" type="range" min={0.8} max={0.95} step={0.01} value={prefs.retencion} onChange={(e) => setPrefs({ ...prefs, retencion: Number(e.target.value) })} className="w-full accent-marca-600" />
        <p className="text-xs text-slate-500">Más alta = repasos más frecuentes y más seguridad de recordar. 90 % es un buen equilibrio.</p>
        <button type="button" className="boton-secundario" onClick={() => guardar({ preferencias: prefs })}>Guardar</button>
      </section>

      {uso && (
        <section className="tarjeta space-y-3">
          <h2 className="font-bold">Uso de la IA hoy</h2>
          {Object.entries(uso.uso).map(([k, v]) => (
            <div key={k}>
              <div className="mb-1 flex justify-between text-sm"><span>{NOMBRE_USO[k] ?? k}</span><span className="tabular-nums text-slate-500">{v.usados}/{v.limite}</span></div>
              <BarraProgreso valor={v.limite ? (v.usados / v.limite) * 100 : 0} alto="h-2" />
            </div>
          ))}
          <p className="text-xs text-slate-500">Los límites se renuevan cada día. Si llegas al límite, puedes seguir usando todo lo que ya tienes.</p>
        </section>
      )}

      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <div className="flex gap-3">
          <Link to="/privacidad" className="text-marca-700 underline">Privacidad</Link>
          <Link to="/terminos" className="text-marca-700 underline">Términos</Link>
        </div>
        <button type="button" className="boton-fantasma" onClick={salir}>Cerrar sesión</button>
      </div>

      <Modal abierto={borrar} alCerrar={() => setBorrar(false)} titulo="Borrar todos tus datos">
        <div className="space-y-3">
          <Aviso tipo="error">Se borrarán tu cuenta, tus exámenes, tus apuntes y fotos y todo lo generado. No se puede deshacer.</Aviso>
          <p className="text-sm">Si quieres guardar una copia, exporta antes tus datos. Para confirmar, escribe <strong>BORRAR</strong>:</p>
          <input className="campo" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} aria-label="Confirmación" />
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-fantasma" onClick={() => setBorrar(false)}>Cancelar</button>
            <button type="button" className="boton bg-rose-600 text-white" disabled={confirmacion !== "BORRAR" || ocupado} onClick={borrarCuenta}>{ocupado ? "Borrando…" : "Borrar definitivamente"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
