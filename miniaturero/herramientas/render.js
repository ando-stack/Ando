// Renderiza un HTML a PNG con Chromium (Playwright).
// Uso: node herramientas/render.js proyecto/miniatura.html salida/miniatura.png [ancho=1280] [alto=720] [escala=3]
// Se maqueta a 1280x720 y se exporta a escala x3 => 3840x2160 (recomendación actual de YouTube).
// Pósters: 4:5 => 1080 1350 2 ; 9:16 => 1080 1920 2
const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const [html, salida, ancho = '1280', alto = '720', escala = '3'] = process.argv.slice(2);
  if (!html || !salida) { console.error('Uso: node render.js entrada.html salida.png [ancho] [alto] [escala]'); process.exit(1); }
  const nav = await chromium.launch();
  const pag = await nav.newPage({ viewport: { width: +ancho, height: +alto }, deviceScaleFactor: +escala });
  await pag.goto(pathToFileURL(path.resolve(html)).href, { waitUntil: 'networkidle' });
  await pag.evaluate(() => document.fonts.ready);
  const faltan = await pag.evaluate(() => [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src));
  if (faltan.length) console.warn('⚠ Imágenes que no cargan:', faltan);
  const fuentes = await pag.evaluate(() => [...document.fonts].filter(f => f.status !== 'loaded').map(f => f.family));
  if (fuentes.length) console.warn('⚠ Fuentes sin cargar:', fuentes);
  await pag.screenshot({ path: salida, clip: { x: 0, y: 0, width: +ancho, height: +alto } });
  await nav.close();
  console.log(`PNG: ${salida} (${ancho * escala}x${alto * escala})`);
})();
