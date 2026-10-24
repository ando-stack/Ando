// Genera fotos de apuntes de muestra (Historia manuscrita, Matemáticas con fórmulas y Biología impresa con esquema)
// con su transcripción de referencia, para probar la lectura sin tener fotos a mano.
// Simula una foto real: fondo de mesa, hoja girada, sombra y ligero desenfoque.
//   npm run muestras   →   scripts/muestras/*.jpg + *.txt
// IMPORTANTE: no sustituyen a fotos reales; para la prueba de verdad usa tus propias fotos.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const DIR = join(process.cwd(), "scripts/muestras");
mkdirSync(DIR, { recursive: true });

const MUESTRAS = [
  {
    nombre: "historia-manuscrito",
    fuente: "'Caveat', cursive",
    tam: 30,
    giro: -3.5,
    desenfoque: 0.6,
    html: `<h2>Tema 6. La crisis de la Restauración</h2>
<p><u>Crisis de 1917</u>: coinciden 3 crisis</p>
<ul><li>Militar → Juntas de Defensa (protestas por ascensos y sueldos)</li>
<li>Política → Asamblea de Parlamentarios en Barcelona</li>
<li>Social → huelga general revolucionaria (agosto)</li></ul>
<p>Causa: inflación por la 1ª Guerra Mundial (España neutral).</p>
<p>1923: golpe de Estado de Primo de Rivera → Dictadura (1923-1930).</p>`,
    texto: `Tema 6. La crisis de la Restauración
Crisis de 1917: coinciden 3 crisis
Militar → Juntas de Defensa (protestas por ascensos y sueldos)
Política → Asamblea de Parlamentarios en Barcelona
Social → huelga general revolucionaria (agosto)
Causa: inflación por la 1ª Guerra Mundial (España neutral).
1923: golpe de Estado de Primo de Rivera → Dictadura (1923-1930).`,
  },
  {
    nombre: "matematicas-formulas",
    fuente: "'Kalam', cursive",
    tam: 27,
    giro: 2.5,
    desenfoque: 0.5,
    html: `<h2>Ecuaciones de 2º grado</h2>
<p>Forma general: ax² + bx + c = 0 (a ≠ 0)</p>
<p>Fórmula: x = (−b ± √(b² − 4ac)) / 2a</p>
<p>Discriminante Δ = b² − 4ac</p>
<ul><li>Δ &gt; 0 → 2 soluciones reales</li><li>Δ = 0 → 1 solución doble</li><li>Δ &lt; 0 → no hay soluciones reales</li></ul>
<p>Ejemplo: x² − 5x + 6 = 0 → Δ = 25 − 24 = 1 → x = 3, x = 2</p>`,
    texto: `Ecuaciones de 2º grado
Forma general: ax^2 + bx + c = 0 (a ≠ 0)
Fórmula: x = (-b ± √(b^2 - 4ac)) / 2a
Discriminante Δ = b^2 - 4ac
Δ > 0 → 2 soluciones reales
Δ = 0 → 1 solución doble
Δ < 0 → no hay soluciones reales
Ejemplo: x^2 - 5x + 6 = 0 → Δ = 25 - 24 = 1 → x = 3, x = 2`,
  },
  {
    nombre: "biologia-impreso",
    fuente: "Georgia, serif",
    tam: 22,
    giro: -1.5,
    desenfoque: 0.4,
    html: `<h2>3. La mitosis</h2>
<p>La mitosis es la división del núcleo que produce dos núcleos hijos con la misma información genética que la célula madre.</p>
<table><tr><th>Fase</th><th>Qué ocurre</th></tr>
<tr><td>Profase</td><td>Los cromosomas se condensan</td></tr>
<tr><td>Metafase</td><td>Los cromosomas se alinean en el ecuador</td></tr>
<tr><td>Anafase</td><td>Las cromátidas se separan hacia los polos</td></tr>
<tr><td>Telofase</td><td>Se forman dos núcleos nuevos</td></tr></table>
<p>Después, la citocinesis divide el citoplasma.</p>`,
    texto: `3. La mitosis
La mitosis es la división del núcleo que produce dos núcleos hijos con la misma información genética que la célula madre.
Fase Qué ocurre
Profase Los cromosomas se condensan
Metafase Los cromosomas se alinean en el ecuador
Anafase Las cromátidas se separan hacia los polos
Telofase Se forman dos núcleos nuevos
Después, la citocinesis divide el citoplasma.`,
  },
];

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1100, height: 1400 } });
for (const m of MUESTRAS) {
  await pagina.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500&family=Kalam&display=swap" rel="stylesheet">
<style>
body{margin:0;background:radial-gradient(circle at 30% 20%,#9a7b5b,#5d4630);height:1400px;display:flex;align-items:center;justify-content:center}
.hoja{width:820px;min-height:1080px;background:#fdfcf7 repeating-linear-gradient(#fdfcf7 0 37px,#c9d8ee 37px 38px);padding:60px 70px;box-sizing:border-box;
transform:rotate(${m.giro}deg);box-shadow:0 30px 60px rgba(0,0,0,.45);filter:blur(${m.desenfoque}px);font-family:${m.fuente};font-size:${m.tam}px;color:#1f2a5a;line-height:38px}
h2{font-size:1.25em;margin:0 0 14px} table{border-collapse:collapse} td,th{border:1px solid #444;padding:4px 10px;line-height:1.3}
</style></head><body><div class="hoja">${m.html}</div></body></html>`);
  await pagina.waitForTimeout(1200);
  await pagina.screenshot({ path: join(DIR, `${m.nombre}.jpg`), type: "jpeg", quality: 80 });
  writeFileSync(join(DIR, `${m.nombre}.txt`), m.texto + "\n");
  console.log(`✓ ${m.nombre}.jpg`);
}
await navegador.close();
