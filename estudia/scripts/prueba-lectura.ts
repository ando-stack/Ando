/**
 * Prueba de calidad con apuntes reales: lectura de fotos + fidelidad del material generado.
 *
 *   ANTHROPIC_API_KEY=… npm run prueba:lectura -- [carpeta]
 *
 * Por cada imagen/PDF de la carpeta (por defecto scripts/muestras):
 *  1. La lee con el mismo prompt y esquema que la web.
 *  2. Si hay un .txt con el mismo nombre (transcripción correcta), calcula la tasa de error
 *     por caracteres (CER) y por palabras (WER).
 *  3. Genera flashcards y un test a partir de lo leído y comprueba:
 *     - que todo cita fragmentos que existen (validarCitas),
 *     - el "apoyo léxico": qué parte de las palabras de cada elemento aparece en los fragmentos citados
 *       (un apoyo bajo indica posible contenido inventado; se listan para revisarlos a mano).
 * Escribe el informe en scripts/salida/informe.md. No usa la base de datos.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pedirJSON } from "../netlify/functions/_shared/claude";
import { esquemaFlashcards, esquemaLectura, esquemaTest } from "../netlify/functions/_shared/esquemas";
import { SISTEMA_ESTUDIO, SISTEMA_LECTURA, contextoExamen, tareaFlashcards, tareaTest } from "../netlify/functions/_shared/prompts";
import { prepararFragmentos } from "../netlify/functions/_shared/fragmentos";
import { fragmentar } from "../src/lib/fragmentar";
import { mapaReferencias, validarCitas, type FragmentoCitable } from "../src/lib/citas";
import { normalizar } from "../src/lib/corregir";

const carpeta = process.argv[2] ?? join(process.cwd(), "scripts/muestras");
const salida = join(process.cwd(), "scripts/salida");
mkdirSync(salida, { recursive: true });

function distancia<T>(a: T[], b: T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Texto comparable: sin Markdown/LaTeX, minúsculas, sin tildes ni signos. */
function plano(s: string): string {
  return normalizar(
    s
      .replace(/<!--.*?-->/g, " ")
      .replace(/\[\[\?(.*?)\?\]\]/g, "$1")
      .replace(/\\(frac|sqrt|pm|cdot|times|neq|Delta|ne|le|ge|rightarrow|to)/g, (m) => ({ "\\pm": "±", "\\neq": "≠", "\\ne": "≠", "\\Delta": "Δ", "\\rightarrow": "→", "\\to": "→" })[m] ?? " ")
      .replace(/[#*_`$|{}\\^-]/g, " "),
  );
}

const PALABRAS_VACIAS = new Set("el la los las un una de del al y o en a que es por con se su sus lo como para mas más este esta".split(" "));
function apoyo(texto: string, fuentes: string[], frags: Map<string, string>): number {
  const palabras = plano(texto).split(" ").filter((p) => p.length > 2 && !PALABRAS_VACIAS.has(p));
  if (!palabras.length) return 1;
  const base = ` ${fuentes.map((f) => plano(frags.get(f) ?? "")).join(" ")} `;
  return palabras.filter((p) => base.includes(p.slice(0, Math.max(4, p.length - 2)))).length / palabras.length;
}

async function principal() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Falta ANTHROPIC_API_KEY. Ejemplo: ANTHROPIC_API_KEY=sk-ant-… npm run prueba:lectura -- ./mis-fotos");
    process.exit(1);
  }
  const archivos = readdirSync(carpeta).filter((f) => /\.(jpe?g|png|webp|pdf)$/i.test(f));
  if (!archivos.length) throw new Error(`No hay imágenes ni PDF en ${carpeta} (genera muestras con: npm run muestras)`);
  const informe: string[] = [`# Informe de prueba de lectura y fidelidad\n\nCarpeta: \`${carpeta}\` · ${new Date().toLocaleString("es-ES")}\n`];
  const resumen: string[] = ["| Archivo | Calidad | Dudas | CER | WER | Flashcards (válidas/descartadas) | Preguntas (válidas/descartadas) | Elementos con apoyo < 50 % |", "|---|---|---|---|---|---|---|---|"];

  for (const nombre of archivos) {
    const ruta = join(carpeta, nombre);
    const datos = readFileSync(ruta).toString("base64");
    const esPdf = extname(nombre).toLowerCase() === ".pdf";
    const mime = esPdf ? "application/pdf" : nombre.toLowerCase().endsWith(".png") ? "image/png" : nombre.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
    console.log(`→ ${nombre}: leyendo…`);
    const lectura = await pedirJSON({
      userId: "prueba",
      tipo: "lectura",
      operacion: "leer_apuntes",
      registrar: false,
      sistema: SISTEMA_LECTURA,
      esquema: esquemaLectura,
      esfuerzo: "high",
      maxTokens: 64000,
      contenido: [
        esPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos } }
          : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: datos } },
        { type: "text", text: "Transcribe estos apuntes siguiendo las reglas." },
      ],
    });
    const texto = lectura.paginas.map((p) => (lectura.paginas.length > 1 ? `<!-- pagina:${p.numero} -->\n\n${p.markdown}` : p.markdown)).join("\n\n");
    const dudas = (texto.match(/\[\[\?/g) ?? []).length;
    writeFileSync(join(salida, `${basename(nombre, extname(nombre))}.md`), texto);

    let cer = "—";
    let wer = "—";
    const ref = join(carpeta, `${basename(nombre, extname(nombre))}.txt`);
    if (existsSync(ref)) {
      const a = plano(readFileSync(ref, "utf8"));
      const b = plano(texto);
      cer = `${((distancia([...a], [...b]) / Math.max(1, a.length)) * 100).toFixed(1)} %`;
      wer = `${((distancia(a.split(" "), b.split(" ")) / Math.max(1, a.split(" ").length)) * 100).toFixed(1)} %`;
    }

    // Generación y comprobación de fidelidad
    console.log(`→ ${nombre}: generando material…`);
    const frags = fragmentar(texto, nombre, lectura.paginas.length > 1).map((f, i) => ({ id: `chunk-${i}`, topic_id: null, upload_id: "u", origen: f.origen, seccion: f.seccion, contenido: f.contenido }));
    const prep = prepararFragmentos(frags, new Map());
    const mapa = mapaReferencias(prep.citables);
    const contenidoPorRef = new Map(prep.citables.map((c: FragmentoCitable) => [c.ref, frags.find((f) => f.id === c.chunk_id)!.contenido]));
    const base = `${contextoExamen({ asignatura: "(prueba)", curso: null, tipo: "mixto", nota_objetivo: 8 }, "examen completo")}\n\n${prep.texto}\n\n`;
    const [fc, ts] = await Promise.all([
      pedirJSON({ userId: "prueba", tipo: "generacion", operacion: "flashcards", registrar: false, sistema: SISTEMA_ESTUDIO, esquema: esquemaFlashcards, contenido: base + tareaFlashcards(10) }),
      pedirJSON({ userId: "prueba", tipo: "generacion", operacion: "test", registrar: false, sistema: SISTEMA_ESTUDIO, esquema: esquemaTest, contenido: base + tareaTest(8, true) }),
    ]);
    const vf = validarCitas(fc.tarjetas, mapa, { permitirAmpliaciones: false });
    const vt = validarCitas(ts.preguntas, mapa);
    const sospechosos: string[] = [];
    for (const t of fc.tarjetas) if (apoyo(`${t.anverso} ${t.reverso}`, t.fuentes, contenidoPorRef) < 0.5) sospechosos.push(`Flashcard: ${t.anverso} → ${t.reverso}`);
    for (const p of ts.preguntas) if (!p.ampliacion && apoyo(`${p.enunciado} ${p.explicacion}`, p.fuentes, contenidoPorRef) < 0.5) sospechosos.push(`Pregunta: ${p.enunciado}`);

    resumen.push(`| ${nombre} | ${lectura.calidad}${lectura.legible ? "" : " (ilegible)"} | ${dudas} | ${cer} | ${wer} | ${vf.validos.length}/${vf.descartados} | ${vt.validos.length}/${vt.descartados} | ${sospechosos.length} |`);
    informe.push(`## ${nombre}\n\n**Aviso de la IA:** ${lectura.aviso || "—"}\n\n### Transcripción\n\n${texto}\n\n### Para revisar a mano (apoyo léxico bajo)\n\n${sospechosos.map((s) => `- ${s}`).join("\n") || "- Ninguno"}\n`);
    console.log(`✓ ${nombre}: CER ${cer}, dudas ${dudas}, descartados ${vf.descartados + vt.descartados}, sospechosos ${sospechosos.length}`);
  }
  informe.splice(1, 0, `## Resumen\n\n${resumen.join("\n")}\n`);
  writeFileSync(join(salida, "informe.md"), informe.join("\n"));
  console.log(`\nInforme: ${join(salida, "informe.md")}`);
}

principal().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
