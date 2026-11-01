// Comprobación visual de los efectos de texto sobre un lienzo en blanco.
// Uso: node tests/e2e/efectos_texto.mjs [url] [salida]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const URL = process.argv[2] ?? 'http://127.0.0.1:8000';
const SALIDA = process.argv[3] ?? path.resolve('test-images/resultados/e2e');
fs.mkdirSync(SALIDA, { recursive: true });
const errores = [];
const nav = await chromium.launch();
const p = await nav.newPage({ viewport: { width: 1600, height: 950 } });
p.on('console', (m) => ['error', 'warning'].includes(m.type()) && errores.push(m.text()));
p.on('pageerror', (e) => errores.push(e.message));
await p.goto(URL);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.getByTestId('nuevo-proyecto').click();
await p.getByTestId('herr-select').waitFor();
const caja = await p.getByTestId('lienzo').boundingBox();
const estilos = ['Fuego', 'Neón', '3D deportivo', 'Doble contorno', 'Cómic'];
for (let i = 0; i < estilos.length; i++) {
  await p.getByTestId('herr-text').click();
  await p.mouse.click(caja.x + caja.width * (i % 2 ? 0.55 : 0.2), caja.y + caja.height * (0.2 + 0.15 * i));
  await p.getByTestId('editor-texto').fill(estilos[i].toUpperCase());
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: estilos[i], exact: true }).click();
  await p.waitForTimeout(300);
}
// texto curvado
const curva = p.locator('label', { hasText: 'Curvatura' }).locator('input[type=range]');
await curva.fill('60');
await p.waitForTimeout(500);
await p.keyboard.press('Escape');
await p.screenshot({ path: path.join(SALIDA, '06_efectos_texto.png') });
await nav.close();
console.log(errores.length ? 'Errores:\n' + errores.join('\n') : 'Sin errores en consola.');
process.exitCode = errores.length ? 1 : 0;
