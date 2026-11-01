// Prueba de extremo a extremo del editor con Playwright (Chromium).
// Requiere el motor (127.0.0.1:8000) y el editor (por defecto http://127.0.0.1:5173) en marcha.
// Uso: node tests/e2e/flujo.mjs [url] [imagen] [carpetaCapturas]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// Playwright puede estar instalado globalmente (NODE_PATH) o en el proyecto
const { chromium } = createRequire(import.meta.url)('playwright');

const URL = process.argv[2] ?? 'http://127.0.0.1:5173';
const IMAGEN = process.argv[3] ?? path.resolve('test-images/01_miniatura_reaccion.jpg');
const SALIDA = process.argv[4] ?? path.resolve('test-images/resultados/e2e');
fs.mkdirSync(SALIDA, { recursive: true });

const errores = [];
const navegador = await chromium.launch();
const ctx = await navegador.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errores.push(`[${m.type()}] ${m.text()}`);
});
p.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));

const paso = async (nombre, fn) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`✔ ${nombre} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.log(`✘ ${nombre}: ${e.message}`);
    await p.screenshot({ path: path.join(SALIDA, `fallo_${nombre.replace(/\W+/g, '_')}.png`) });
    throw e;
  }
};
const captura = (n) => p.screenshot({ path: path.join(SALIDA, n) });
const capas = () => p.locator('[data-testid=fila-capa]').count();

try {
  await p.goto(URL);
  await paso('Diálogo de inicio visible', async () => {
    await p.getByTestId('zona-subida').waitFor({ timeout: 15000 });
  });

  await paso('Subir imagen y descomponer en capas', async () => {
    await p.getByTestId('input-subida').setInputFiles(IMAGEN);
    await p.getByTestId('aviso-derechos').waitFor();
    await p.getByTestId('lista-capas').locator('[data-testid=fila-capa]').first().waitFor({ timeout: 240000 });
    await p.waitForTimeout(1500);
    await captura('01_descompuesta.png');
    const n = await capas();
    if (n < 4) throw new Error(`Solo ${n} capas`);
  });

  await paso('La reconstrucción en el navegador se parece al original', async () => {
    const r = await p.evaluate(async () => {
      const e = window.estudio;
      const doc = e.doc();
      const orig = doc.layers.find((l) => l.role === 'original');
      const carga = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [a, b] = await Promise.all([carga(e.renderizar()), carga(orig.src)]);
      const c = document.createElement('canvas');
      c.width = doc.width; c.height = doc.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(a, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
      x.clearRect(0, 0, c.width, c.height); x.drawImage(b, 0, 0, c.width, c.height); const db = x.getImageData(0, 0, c.width, c.height).data;
      let suma = 0, distintos = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        suma += d; if (d > 40) distintos++;
      }
      const n = da.length / 4;
      return { media: suma / n, distintos: distintos / n };
    });
    console.log(`   diferencia media ${r.media.toFixed(1)}/255, píxeles muy distintos ${(r.distintos * 100).toFixed(1)}%`);
    if (r.distintos > 0.08) throw new Error('La reconstrucción difiere demasiado del original');
  });

  await paso('Editar un texto detectado (con deshacer/rehacer)', async () => {
    const fila = p.locator('[data-testid=fila-capa]', { hasText: 'Texto:' }).first();
    await fila.click();
    const area = p.getByTestId('contenido-texto');
    const original = await area.inputValue();
    await area.fill('¡LO HE CONSEGUIDO!');
    await p.waitForTimeout(400);
    await captura('02_texto_editado.png');
    await p.locator('body').click({ position: { x: 5, y: 500 } }).catch(() => undefined);
    await p.getByTestId('deshacer').click();
    await p.waitForTimeout(200);
    const tras = await p.locator('[data-testid=fila-capa]', { hasText: original.slice(0, 10) }).count();
    if (!tras) throw new Error('Deshacer no restauró el texto');
    await p.getByTestId('rehacer').click();
  });

  await paso('Mover una capa con el teclado y duplicarla', async () => {
    const n0 = await capas();
    await p.keyboard.press('Shift+ArrowRight');
    await p.keyboard.press('Control+d');
    await p.waitForTimeout(200);
    if ((await capas()) !== n0 + 1) throw new Error('No se duplicó');
    await p.keyboard.press('Delete');
    await p.waitForTimeout(200);
    if ((await capas()) !== n0) throw new Error('No se eliminó');
  });

  await paso('Añadir texto con estilo predefinido y forma', async () => {
    await p.getByTestId('herr-text').click();
    const caja = await p.getByTestId('lienzo').boundingBox();
    await p.mouse.click(caja.x + caja.width * 0.3, caja.y + caja.height * 0.75);
    await p.getByTestId('editor-texto').fill('GOLAZO');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: '3D deportivo' }).click();
    await p.getByTestId('herr-shape').click();
    await p.mouse.move(caja.x + caja.width * 0.6, caja.y + caja.height * 0.7);
    await p.mouse.down();
    await p.mouse.move(caja.x + caja.width * 0.75, caja.y + caja.height * 0.85, { steps: 5 });
    await p.mouse.up();
    await p.waitForTimeout(400);
    await captura('03_texto_y_forma.png');
  });

  const lienzo = p.getByTestId('lienzo');
  const caja = await lienzo.boundingBox();
  const docAPantalla = async (x, y) => p.evaluate(([x, y]) => {
    const s = window.estudio.doc();
    return [x, y, s.width, s.height];
  }, [x, y]);
  void docAPantalla;
  // coordenadas relativas al documento (0..1) → píxeles de pantalla
  const aPantalla = async (fx, fy) => {
    const c = await p.getByTestId('lienzo').boundingBox();
    const v = await p.evaluate(() => ({ ...window.estudio.vista(), w: window.estudio.doc().width, h: window.estudio.doc().height }));
    return [c.x + v.pan.x + fx * v.w * v.zoom, c.y + v.pan.y + fy * v.h * v.zoom];
  };
  const pintar = async (x0, y0, x1, y1) => {
    const [a, b] = await aPantalla(x0, y0);
    const [c, d] = await aPantalla(x1, y1);
    await p.mouse.move(a, b);
    await p.mouse.down();
    await p.mouse.move(c, d, { steps: 12 });
    await p.mouse.up();
  };
  const esperarLibre = () => p.waitForFunction(() => !document.querySelector('[data-testid=ocupado]'), null, { timeout: 120000 });

  await paso('Máscara de capa con pincel (ocultar sin destruir)', async () => {
    await p.locator('[data-testid=fila-capa]', { hasText: 'Persona' }).first().click();
    await p.getByTestId('herr-mask-hide').click();
    await pintar(0.7, 0.9, 0.8, 0.95);
    await p.waitForFunction(() => window.estudio.doc().layers.some((l) => l.name.startsWith('Persona') && l.maskSrc), null, { timeout: 15000 });
    await p.getByRole('button', { name: 'Quitar máscara' }).waitFor();
  });

  await paso('Borrar objeto con IA en el fondo', async () => {
    await p.locator('[data-testid=fila-capa]', { hasText: 'Fondo reconstruido' }).first().click();
    const antes = await p.evaluate(() => window.estudio.doc().layers.find((l) => l.role === 'fondo').src);
    await p.getByTestId('herr-ai-erase').click();
    await pintar(0.45, 0.55, 0.5, 0.6);
    await esperarLibre();
    await p.waitForFunction((a) => window.estudio.doc().layers.find((l) => l.role === 'fondo').src !== a, antes, { timeout: 120000 });
  });

  await paso('Segmentar una zona con un clic y crear capa', async () => {
    await p.keyboard.press('Escape');
    const n0 = await capas();
    await p.getByTestId('herr-segment').click();
    const [sx, sy] = await aPantalla(0.13, 0.82);
    await p.mouse.click(sx, sy);
    await p.getByTestId('crear-capa-segmento').waitFor();
    await p.waitForFunction(() => !document.querySelector('[data-testid=crear-capa-segmento]')?.hasAttribute('disabled'), null, { timeout: 60000 });
    await p.getByTestId('crear-capa-segmento').click();
    await p.waitForFunction((n) => document.querySelectorAll('[data-testid=fila-capa]').length === n + 1, n0, { timeout: 30000 });
    await p.getByTestId('herr-select').click();
    await captura('03b_segmentado.png');
  });

  await paso('Importar imagen propia con eliminación de fondo', async () => {
    const n0 = await capas();
    await p.getByTestId('importar-imagen').click();
    await p.getByTestId('input-importar').setInputFiles(path.resolve('test-images/_fuentes_originales/s90-38573.jpg'));
    await p.waitForFunction((n) => document.querySelectorAll('[data-testid=fila-capa]').length === n + 1, n0, { timeout: 180000 });
    await esperarLibre();
    await captura('03c_importada.png');
  });

  await paso('Añadir superposición de luces y unir dos capas', async () => {
    await p.getByRole('button', { name: 'Efectos y texturas' }).click();
    await p.getByRole('button', { name: 'destello lente' }).click();
    await p.getByRole('button', { name: 'Propiedades' }).click();
    const n0 = await capas();
    await p.locator('[data-testid=fila-capa]').nth(1).click();
    await p.locator('[data-testid=fila-capa]').nth(2).click({ modifiers: ['Shift'] });
    await p.keyboard.press('Control+e');
    await esperarLibre();
    await p.waitForFunction((n) => document.querySelectorAll('[data-testid=fila-capa]').length === n - 1, n0, { timeout: 30000 });
    await p.keyboard.press('Control+z');
    await p.waitForFunction((n) => document.querySelectorAll('[data-testid=fila-capa]').length === n, n0);
  });

  await paso('Cambiar a formato Instagram 4:5 con recolocación', async () => {
    await p.getByTestId('boton-formato').click();
    await p.getByTestId('formato-ig-45').click();
    await p.waitForTimeout(800);
    await captura('04_formato_ig45.png');
    await p.getByTestId('boton-formato').click();
    await p.getByTestId('formato-yt-movil').click();
    await p.waitForTimeout(500);
  });

  await paso('Exportar JPG respetando 2 MB', async () => {
    await p.getByTestId('boton-exportar').click();
    const espera = p.waitForEvent('download');
    await p.getByTestId('exportar-ahora').click();
    const d = await espera;
    const destino = path.join(SALIDA, d.suggestedFilename());
    await d.saveAs(destino);
    const tam = fs.statSync(destino).size;
    if (tam > 2 * 1024 * 1024) throw new Error(`Supera 2 MB: ${tam}`);
    console.log(`   archivo ${d.suggestedFilename()} ${(tam / 1024).toFixed(0)} KB`);
    await p.getByTestId('resultado-export').waitFor();
    await p.keyboard.press('Escape');
  });

  await paso('Vista previa móvil', async () => {
    await p.getByRole('button', { name: 'Vista previa en el móvil' }).click();
    await p.getByTestId('vista-movil').waitFor();
    await p.waitForTimeout(500);
    await captura('05_vista_movil.png');
    await p.locator('[aria-label="Cerrar"]').first().click();
  });

  await paso('Guardado automático', async () => {
    await p.waitForFunction(() => document.querySelector('[data-testid=estado-guardado]')?.textContent === 'Guardado', null, { timeout: 15000 });
  });
} finally {
  await captura('99_final.png').catch(() => undefined);
  await navegador.close();
  const relevantes = errores.filter((e) => !/Download the React DevTools/.test(e));
  console.log(relevantes.length ? `Errores/avisos en consola (${relevantes.length}):\n${relevantes.join('\n')}` : 'Consola del navegador sin errores.');
  if (relevantes.length) process.exitCode = 1;
}
