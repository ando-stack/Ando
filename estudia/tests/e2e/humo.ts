/**
 * Prueba de humo de la interfaz: abre todas las pantallas en tamaño móvil con un backend
 * simulado (Supabase y /api interceptados) y falla si hay errores en la consola.
 *
 *   VITE_SUPABASE_URL=http://falso.supabase.local VITE_SUPABASE_ANON_KEY=x npx vite build --outDir dist-e2e
 *   npx tsx tests/e2e/humo.ts
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { generarPlan } from "../../src/lib/plan";
import { hoyISO, sumarDias } from "../../src/lib/fechas";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const DIST = join(process.cwd(), "dist-e2e");
const SALIDA = process.env.CAPTURAS ?? join(process.cwd(), "tests/e2e/capturas");
mkdirSync(SALIDA, { recursive: true });
const UID = "11111111-1111-1111-1111-111111111111";
const EX = "22222222-2222-2222-2222-222222222222";
const T1 = "33333333-3333-3333-3333-333333333331";
const T2 = "33333333-3333-3333-3333-333333333332";
const ahora = new Date();
const enDias = (n: number) => new Date(ahora.getTime() + n * 86_400_000).toISOString();
const F = (id: string, origen: string) => ({ chunk_id: id, origen });

const examen = {
  id: EX, user_id: UID, asignatura: "Historia de España", curso: "2.º Bachillerato", fecha: enDias(9), nota_objetivo: 8,
  tipo: "mixto", distribucion: { test: 30, cortas: 30, desarrollo: 40, problemas: 0 }, duracion_min: 90,
  disponibilidad: { "0": 30, "1": 60, "2": 60, "3": 60, "4": 60, "5": 45, "6": 30 }, nivel_actual: "medio", color: "#7c3aed", archivado: false, created_at: enDias(-3),
};
const temas = [
  { id: T1, exam_id: EX, user_id: UID, titulo: "La crisis de la Restauración", orden: 0 },
  { id: T2, exam_id: EX, user_id: UID, titulo: "La Segunda República", orden: 1 },
];
const plan = generarPlan({ hoy: sumarDias(hoyISO(), -2), fechaExamen: examen.fecha, disponibilidad: examen.disponibilidad, notaObjetivo: 8, nivelActual: "medio", duracionExamenMin: 90, temas: [{ id: T1, titulo: temas[0].titulo, palabras: 1800, dominio: 0.2 }, { id: T2, titulo: temas[1].titulo, palabras: 2200, dominio: 0 }] });
const primeraTarea = plan.dias[0].tareas[0]?.id;

const tablas: Record<string, Record<string, unknown>[]> = {
  profiles: [{ id: UID, nombre: "Lucía", fecha_nacimiento: "2009-03-02", consentimiento_estado: "concedido", consentimiento_ia: true, tutor_email: null, preferencias: { pomodoro: { trabajo: 25, descanso: 5, descanso_largo: 15, ciclos: 4 }, notificaciones: { activas: false, hora: "17:30" }, retencion: 0.9 } }],
  exams: [examen],
  exam_topics: temas,
  uploads: [
    { id: "u1", user_id: UID, exam_id: EX, topic_id: T1, tipo: "imagen", storage_path: `${UID}/${EX}/a.jpg`, nombre_original: "Foto 1", orden: 0, estado: "revisar", error: null, created_at: enDias(-1) },
    { id: "u2", user_id: UID, exam_id: EX, topic_id: T2, tipo: "pdf", storage_path: `${UID}/${EX}/b.pdf`, nombre_original: "Tema 7.pdf", orden: 1, estado: "confirmado", error: null, created_at: enDias(-1) },
    { id: "u3", user_id: UID, exam_id: EX, topic_id: null, tipo: "imagen", storage_path: `${UID}/${EX}/c.jpg`, nombre_original: "Foto 2", orden: 2, estado: "error", error: "La foto está muy borrosa. Prueba con más luz.", created_at: enDias(-1) },
  ],
  extracted_texts: [
    { id: "e1", upload_id: "u1", exam_id: EX, contenido: "# La crisis de 1917\n\nEn 1917 coincidieron tres crisis: militar (Juntas de Defensa), política (Asamblea de Parlamentarios) y social (huelga general de [[?agosto?]]).\n\n- Causas: inflación por la Primera Guerra Mundial\n- Consecuencia → fin del turnismo", dudas: [{ id: "d1", texto: "agosto", motivo: "Letra poco clara", pagina: 1, resuelta: false }], secciones: [], calidad: "regular", legible: true, aviso: "Hay una palabra que no se lee bien.", paginas: 1, revisado: false, editado_por_usuario: false },
  ],
  chunks: [{ id: "c1", topic_id: T1, upload_id: "u1", contenido: "En 1917 coincidieron tres crisis…", seccion: "La crisis de 1917" }, { id: "c2", topic_id: T2, upload_id: "u2", contenido: "La Constitución de 1931 estableció el sufragio femenino.", seccion: "Constitución de 1931" }],
  summaries: [{ id: "s1", exam_id: EX, topic_id: T1, desactualizado: false, created_at: enDias(-1), ideas_clave: [{ texto: "En **1917** coincidieron tres crisis: militar, política y social.", fuentes: [F("c1", "Foto 1")], ampliacion: false }, { texto: "La inflación provocada por la guerra encareció la vida.", fuentes: [F("c1", "Foto 1")], ampliacion: false }, { texto: "España fue neutral en la Primera Guerra Mundial.", fuentes: [], ampliacion: true }], resumen: [{ texto: "La crisis de 1917 debilitó el sistema de turnos…", fuentes: [F("c1", "Foto 1")], ampliacion: false }], detallado: [{ texto: "### Crisis militar\nLas Juntas de Defensa…", fuentes: [F("c1", "Foto 1")], ampliacion: false }] }],
  mindmaps: [{ id: "m1", exam_id: EX, topic_id: T1, titulo: "La crisis de 1917", desactualizado: false, raiz: { id: "n1", texto: "Crisis de 1917", fuentes: [F("c1", "Foto 1")], ampliacion: false, hijos: [{ id: "n2", texto: "Militar → Juntas de Defensa", fuentes: [F("c1", "Foto 1")], ampliacion: false, hijos: [{ id: "n5", texto: "Protestan por ascensos y sueldos", fuentes: [F("c1", "Foto 1")], ampliacion: false, hijos: [] }] }, { id: "n3", texto: "Política → Asamblea de Parlamentarios", fuentes: [F("c1", "Foto 1")], ampliacion: false, hijos: [] }, { id: "n4", texto: "Social → huelga general", fuentes: [F("c1", "Foto 1")], ampliacion: false, hijos: [] }] } }],
  flashcards: [
    { id: "f1", exam_id: EX, topic_id: T1, tipo: "fecha", anverso: "¿En qué año coincidieron la crisis militar, política y social?", reverso: "En **1917**", fuentes: [F("c1", "Foto 1")], ampliacion: false, editada: false, suspendida: false, estado: "nueva", estabilidad: 0, dificultad: 0, vence: enDias(0), ultima_revision: null, repeticiones: 0, fallos: 0, created_at: enDias(-1) },
    { id: "f2", exam_id: EX, topic_id: T2, tipo: "formula", anverso: "Fórmula del área del círculo", reverso: "$A = \\pi r^2$", fuentes: [F("c2", "PDF «Tema 7» · p. 2")], ampliacion: false, editada: false, suspendida: false, estado: "repaso", estabilidad: 3, dificultad: 5, vence: enDias(-1), ultima_revision: enDias(-4), repeticiones: 2, fallos: 0, created_at: enDias(-2) },
  ],
  quizzes: [{ id: "q1", exam_id: EX, topic_id: T1, titulo: "Test · La crisis de la Restauración", created_at: enDias(-1), preguntas: [
    { id: "p1", tipo: "opcion_multiple", enunciado: "¿Qué grupo protagonizó la crisis militar de 1917?", topic_id: T1, opciones: ["Las Juntas de Defensa", "La CNT", "Los carlistas", "La Lliga"], correcta: 0, explicacion: "Según tus apuntes, fueron las Juntas de Defensa.", fuentes: [F("c1", "Foto 1")], ampliacion: false },
    { id: "p2", tipo: "relacionar", enunciado: "Relaciona cada crisis con su protagonista", topic_id: T1, pares: [{ izquierda: "Militar", derecha: "Juntas de Defensa" }, { izquierda: "Política", derecha: "Asamblea de Parlamentarios" }], explicacion: "…", fuentes: [F("c1", "Foto 1")], ampliacion: false },
  ] }],
  quiz_attempts: [{ quiz_id: "q1", nota: 6.5, created_at: enDias(-2), resultados: [{ pregunta_id: "p1", topic_id: T1, correcta: true, puntos: 1 }, { pregunta_id: "p2", topic_id: T1, correcta: false, puntos: 0.5 }], quizzes: { preguntas: [{ id: "p1", enunciado: "¿Qué grupo…?" }, { id: "p2", enunciado: "Relaciona cada crisis" }] } }],
  mock_exams: [{ id: "mk1", exam_id: EX, titulo: "Examen de práctica 1 · Historia de España", duracion_min: 90, distribucion: {}, created_at: enDias(-1), preguntas: [
    { id: "q1", tipo: "test", topic_id: T1, enunciado: "¿En qué año fue la crisis?", puntos: 3, opciones: ["1909", "1917", "1923", "1931"], correcta: 1, fuentes: [F("c1", "Foto 1")] },
    { id: "q2", tipo: "desarrollo", topic_id: T2, enunciado: "Explica la Constitución de 1931", puntos: 7, respuesta_modelo: "La Constitución de 1931…", rubrica: [{ criterio: "Menciona el sufragio femenino", puntos: 2 }, { criterio: "Contexto", puntos: 1 }], fuentes: [F("c2", "PDF «Tema 7» · p. 2")] },
  ] }],
  mock_exam_attempts: [{ id: "at1", mock_exam_id: "mk1", exam_id: EX, estado: "corregido", nota: 7.2, created_at: enDias(-1), inicio: enDias(-1), fin: enDias(-1), respuestas: { q1: 1, q2: "La Constitución de 1931 aprobó el voto femenino…" }, correccion: { nota: 7.2, resumen: "¡Buen examen! Dominas las fechas.", para_subir_nota: ["Añade el contexto económico."], preguntas: [{ pregunta_id: "q1", puntos_obtenidos: 3, puntos_max: 3, criterios: [], comentario: "¡Correcta!", para_subir_nota: "", fuentes: [] }, { pregunta_id: "q2", puntos_obtenidos: 4.25, puntos_max: 7, criterios: [{ criterio: "Menciona el sufragio femenino", puntos_obtenidos: 4.25, puntos_max: 4.67, comentario: "Bien" }, { criterio: "Contexto", puntos_obtenidos: 0, puntos_max: 2.33, comentario: "Falta" }], comentario: "Bien encaminado.", para_subir_nota: "Explica el contexto de 1931.", fuentes: [F("c2", "PDF «Tema 7» · p. 2")] }] }, mock_exams: { preguntas: [] } }],
  study_plans: [{ id: "pl1", exam_id: EX, dias: plan.dias, viabilidad: plan.viabilidad, version: 1, generado_en: enDias(0) }],
  study_sessions: primeraTarea ? [{ tarea_id: primeraTarea, fecha: hoyISO(), minutos: 30, tipo: "estudio" }] : [],
  streaks: [{ user_id: UID, actual: 4, mejor: 6, ultimo_dia: sumarDias(hoyISO(), -1), descansos: [] }],
  achievements: [{ codigo: "primera_sesion", obtenido_en: enDias(-3) }, { codigo: "racha_3", obtenido_en: enDias(-1) }],
  tutor_messages: [{ id: "tm1", rol: "usuario", contenido: "¿Qué fue la Asamblea de Parlamentarios?", nivel: "normal", fuentes: [], created_at: enDias(-1) }, { id: "tm2", rol: "tutor", contenido: "Según tus apuntes, fue una reunión de diputados en Barcelona…\n\n> **Ampliación:** se celebró en julio; compruébalo.", nivel: "normal", fuentes: [F("c1", "Foto 1")], created_at: enDias(-1) }],
  ai_jobs: [],
  feynman_attempts: [],
};

function filtrar(filas: Record<string, unknown>[], params: URLSearchParams) {
  let r = filas;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "or"].includes(k)) continue;
    if (v.startsWith("eq.")) r = r.filter((f) => String(f[k]) === v.slice(3));
    if (v.startsWith("is.null")) r = r.filter((f) => f[k] === null || f[k] === undefined);
    if (v.startsWith("in.(")) {
      const vals = v.slice(4, -1).split(",").map((x) => x.replace(/"/g, ""));
      r = r.filter((f) => vals.includes(String(f[k])));
    }
  }
  return r;
}

async function principal() {
  if (!existsSync(DIST)) throw new Error("Falta dist-e2e: compila primero (ver cabecera)");
  const servidor = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let ruta = join(DIST, url.pathname);
    if (!existsSync(ruta) || url.pathname === "/") ruta = join(DIST, "index.html");
    const tipos: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff" };
    res.setHeader("content-type", tipos[extname(ruta)] ?? "application/octet-stream");
    res.end(readFileSync(ruta));
  }).listen(4178);

  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-ES" });
  const sesion = { access_token: "tok", refresh_token: "ref", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, email: "lucia@ejemplo.es", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: enDias(-10) } };
  await ctx.addInitScript((s) => localStorage.setItem("sb-falso-auth-token", s), JSON.stringify(sesion));

  await ctx.route("http://falso.supabase.local/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ json: sesion.user });
    if (p.startsWith("/auth/v1/")) return route.fulfill({ json: {} });
    if (p.startsWith("/storage/v1/object/sign")) {
      if (req.method() === "POST" && !p.split("/apuntes/")[1]) {
        const cuerpo = JSON.parse(req.postData() ?? "{}") as { paths?: string[] };
        return route.fulfill({ json: (cuerpo.paths ?? []).map((x) => ({ path: x, signedURL: "/icono.svg", error: null })) });
      }
      return route.fulfill({ json: { signedURL: "/icono.svg" } });
    }
    if (p.startsWith("/storage/v1/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: readFileSync(join(DIST, "icono.svg")) });
    if (p.startsWith("/rest/v1/rpc/")) return route.fulfill({ json: null });
    if (p.startsWith("/rest/v1/")) {
      const tabla = p.slice("/rest/v1/".length);
      const filas = filtrar(tablas[tabla] ?? [], url.searchParams);
      const unico = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      const cabeceras = { "content-range": `0-${Math.max(0, filas.length - 1)}/${filas.length}`, "content-type": "application/json" };
      if (req.method() === "HEAD") return route.fulfill({ status: 200, headers: cabeceras, body: "" });
      if (req.method() !== "GET") return route.fulfill({ status: 201, headers: cabeceras, body: unico ? JSON.stringify({ id: "nuevo" }) : "[]" });
      if (unico) return filas.length ? route.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify(filas[0]) }) : route.fulfill({ status: 406, json: { code: "PGRST116", message: "0 filas" } });
      return route.fulfill({ status: 200, headers: cabeceras, body: JSON.stringify(filas) });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await ctx.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/trabajos") return route.fulfill({ json: { uso: { lectura: { usados: 3, limite: 40 }, generacion: { usados: 5, limite: 30 }, correccion: { usados: 1, limite: 20 }, tutor: { usados: 2, limite: 60 } }, tokens: 1000, limite_tokens: 1500000 } });
    if (p === "/api/plan") return route.fulfill({ json: { plan: tablas.study_plans[0] } });
    if (p === "/api/consentimiento") return route.fulfill({ json: { nombre: "Pablo", version: "2026-10-01" } });
    return route.fulfill({ json: {} });
  });

  const errores: string[] = [];
  const pagina = await ctx.newPage();
  pagina.on("console", (m) => m.type() === "error" && errores.push(`[consola] ${m.text()}`));
  pagina.on("pageerror", (e) => errores.push(`[página] ${e.message}`));
  pagina.on("response", (r) => r.status() >= 400 && r.status() !== 406 && errores.push(`[red] ${r.status()} ${r.url()}`));

  const rutas: [string, string][] = [
    ["/", "inicio"], ["/nuevo", "nuevo-examen"], [`/examen/${EX}`, "panel"], [`/examen/${EX}/plan`, "plan"],
    [`/examen/${EX}/apuntes`, "apuntes"], [`/examen/${EX}/resumenes`, "resumenes"], [`/examen/${EX}/esquemas`, "esquemas"],
    [`/examen/${EX}/flashcards`, "flashcards"], [`/examen/${EX}/tests`, "tests"], [`/examen/${EX}/practica`, "practica"],
    [`/examen/${EX}/practica/mk1?intento=at1`, "correccion"], [`/examen/${EX}/tutor`, "tutor"], ["/calendario", "calendario"],
    ["/perfil", "perfil"], ["/privacidad", "privacidad"], [`/consentimiento/${"a".repeat(64)}`, "consentimiento-tutor"],
  ];
  for (const [ruta, nombre] of rutas) {
    await pagina.goto(`http://localhost:4178${ruta}`, { waitUntil: "networkidle" });
    await pagina.waitForTimeout(700);
    const anchoDoc = await pagina.evaluate(() => document.documentElement.scrollWidth);
    if (anchoDoc > 392) {
      const culpable = await pagina.evaluate(() => {
        const els = [...document.querySelectorAll("body *")] as HTMLElement[];
        const anchos = els.filter((e) => e.getBoundingClientRect().right > 392).map((e) => `${e.tagName}.${String(e.className).slice(0, 60)} → ${Math.round(e.getBoundingClientRect().right)}`);
        return anchos.slice(0, 5).join(" | ");
      });
      errores.push(`[${nombre}] desborda horizontalmente (${anchoDoc}px): ${culpable}`);
    }
    const texto = await pagina.evaluate(() => document.body.innerText);
    if (/Vaya, algo no ha ido bien/.test(texto)) errores.push(`[${nombre}] ha mostrado la pantalla de error`);
    await pagina.screenshot({ path: join(SALIDA, `${nombre}.png`), fullPage: true });
    console.log(`✓ ${nombre}`);
  }

  // Interacciones clave
  await pagina.goto(`http://localhost:4178/examen/${EX}/flashcards`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: "Empezar repaso" }).click();
  await pagina.getByRole("button", { name: "Ver respuesta" }).click();
  await pagina.waitForTimeout(500);
  await pagina.screenshot({ path: join(SALIDA, "flashcard-girada.png") });
  await pagina.getByRole("button", { name: /^Bien/ }).click();
  console.log("✓ repaso de flashcard");

  await pagina.goto(`http://localhost:4178/examen/${EX}/tests`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: /Hacer|Repetir/ }).first().click();
  await pagina.getByRole("button", { name: /Las Juntas de Defensa/ }).click();
  await pagina.getByRole("button", { name: "Comprobar" }).click();
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(SALIDA, "test-corregido.png"), fullPage: true });
  console.log("✓ pregunta de test corregida al instante");

  await pagina.goto(`http://localhost:4178/examen/${EX}/esquemas`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: "Desplegar todo" }).click();
  await pagina.waitForTimeout(600);
  await pagina.screenshot({ path: join(SALIDA, "esquema-desplegado.png"), fullPage: true });
  console.log("✓ mapa conceptual desplegado");

  await pagina.goto(`http://localhost:4178/examen/${EX}/apuntes`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: "Revisar Foto 1" }).click();
  await pagina.waitForTimeout(600);
  await pagina.screenshot({ path: join(SALIDA, "visor-foto-texto.png") });
  console.log("✓ visor foto/texto con dudas");

  await pagina.goto(`http://localhost:4178/nuevo`, { waitUntil: "networkidle" });
  await pagina.getByRole("button", { name: "Historia de España" }).first().click().catch(() => pagina.getByLabel("¿De qué es el examen?").fill("Historia"));
  await pagina.getByLabel("¿De qué es el examen?").fill("Historia de España");
  await pagina.getByRole("button", { name: "Siguiente →" }).click();
  await pagina.getByLabel("Fecha").fill(sumarDias(hoyISO(), 10));
  await pagina.getByRole("button", { name: "Siguiente →" }).click();
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(SALIDA, "nuevo-examen-nota.png") });
  console.log("✓ formulario paso a paso");

  await navegador.close();
  servidor.close();
  if (errores.length) {
    console.error(`\n✗ ${errores.length} problema(s):\n${errores.join("\n")}`);
    process.exit(1);
  }
  console.log("\n✓ Interfaz: todas las pantallas sin errores de consola ni desbordes");
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
