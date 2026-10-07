// Render final con @remotion/renderer. Lo invoca backend/render.py:
//   node render/render.mjs <props.json> <salida.mp4>
// Imprime "PROGRESS x" (0..1) y "STAGE texto" para que el backend muestre el avance.
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition, ensureBrowser} from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const [propsFile, outFile] = process.argv.slice(2);
if (!propsFile || !outFile) {
  console.error('Uso: node render/render.mjs <props.json> <salida.mp4>');
  process.exit(2);
}
const inputProps = JSON.parse(fs.readFileSync(propsFile, 'utf8'));

// El bundle se reutiliza mientras no cambie el código de la composición
function newestMtime(dir) {
  let m = 0;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    m = Math.max(m, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return m;
}
const bundleDir = path.join(here, '.bundle');
const stamp = path.join(bundleDir, '.stamp');
const srcMtime = Math.max(newestMtime(path.join(root, 'src', 'remotion')), fs.statSync(path.join(root, 'src', 'types.ts')).mtimeMs);
let serveUrl = bundleDir;
if (!fs.existsSync(stamp) || Number(fs.readFileSync(stamp, 'utf8')) < srcMtime) {
  console.log('STAGE Preparando la composición');
  serveUrl = await bundle({entryPoint: path.join(root, 'src', 'remotion', 'index.ts'), outDir: bundleDir});
  fs.writeFileSync(stamp, String(srcMtime));
}

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
if (!browserExecutable) {
  console.log('STAGE Comprobando el navegador de render');
  await ensureBrowser();
}
const chromiumOptions = {gl: 'swangle'};
const composition = await selectComposition({serveUrl, id: 'Editor', inputProps, browserExecutable, chromiumOptions});
console.log('STAGE Renderizando');
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  audioCodec: 'aac',
  crf: 16,
  pixelFormat: 'yuv420p',
  outputLocation: outFile,
  inputProps,
  browserExecutable,
  chromiumOptions,
  concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
  timeoutInMilliseconds: 120000,
  onProgress: ({progress}) => console.log(`PROGRESS ${progress.toFixed(4)}`),
});
console.log('PROGRESS 1');
console.log('STAGE Terminado');
