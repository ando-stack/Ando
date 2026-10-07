/**
 * Genera los recursos gráficos de la marca AAM a partir del monograma SVG:
 *   - public/favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
 *   - public/og-image.png (imagen para compartir en redes, 1200×630)
 *   - imágenes de ejemplo para los proyectos (src/assets/images/projects)
 *
 * Uso: npm run brand
 * (Solo hace falta volver a ejecutarlo si cambias el monograma o los colores.)
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BG = '#0B0B0C';
const FG = '#EDEDE8';
const ACCENT = '#C8FF2E';
const VIOLET = '#6D5DFC';

const strokes = `
  <path d="M12 11V89"/><path d="M12 78L31 22L50 78L69 22L88 78"/>
  <path d="M17.4 62H44.6"/><path d="M55.4 62H82.6"/><path d="M88 11V89"/>`;

const mark = (x, y, size, color, width = 7) =>
  `<g transform="translate(${x} ${y}) scale(${size / 100})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="miter" stroke-miterlimit="10">${strokes}</g>`;

const icon = (size, { radius = 0.22, pad = 0.16, width = 8 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${radius * 100}" fill="${BG}"/>
  ${mark(pad * 100, pad * 100, 100 - pad * 200, ACCENT, width)}
</svg>`;

const grain = `
  <filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>
  <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .08 0"/></filter>`;

const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    ${grain}
    <radialGradient id="glow" cx="78%" cy="30%" r="60%">
      <stop offset="0" stop-color="${VIOLET}" stop-opacity=".45"/>
      <stop offset="1" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${BG}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g stroke="${FG}" stroke-opacity=".12">
    <path d="M80 0V630M1120 0V630M0 80H1200M0 550H1200"/>
  </g>
  ${mark(800, 150, 320, ACCENT, 6)}
  <text x="80" y="180" font-family="Arial, Helvetica, sans-serif" font-size="22" letter-spacing="4" fill="${FG}" fill-opacity=".65">AAM — AGENCIA PARA CREADORES</text>
  <text x="80" y="330" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="${FG}">Contenido</text>
  <text x="80" y="430" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="${FG}">con IA</text>
  <rect x="80" y="480" width="64" height="6" fill="${ACCENT}"/>
  <rect width="1200" height="630" filter="url(#g)"/>
</svg>`;

/** Imagen abstracta de ejemplo para proyectos (claramente marcada como provisional). */
const placeholder = (w, h, seed, label) => {
  const rand = (n) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280;
    return x - Math.floor(x);
  };
  const hueA = [ACCENT, VIOLET, '#FF6B5B', '#2EE6C8'][seed % 4];
  const hueB = [VIOLET, '#2EE6C8', ACCENT, '#FF6B5B'][seed % 4];
  const circles = Array.from({ length: 5 }, (_, i) => {
    const r = 120 + rand(i) * 380;
    return `<circle cx="${rand(i + 10) * w}" cy="${rand(i + 20) * h}" r="${r}" fill="none" stroke="${FG}" stroke-opacity="${0.06 + rand(i + 30) * 0.12}" stroke-width="${1 + rand(i + 40) * 2}"/>`;
  }).join('');
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    ${grain}
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#121214"/><stop offset="1" stop-color="#1C1C20"/>
    </linearGradient>
    <radialGradient id="a" cx="${20 + rand(1) * 60}%" cy="${20 + rand(2) * 60}%" r="55%">
      <stop offset="0" stop-color="${hueA}" stop-opacity=".85"/><stop offset="1" stop-color="${hueA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b" cx="${20 + rand(3) * 60}%" cy="${20 + rand(4) * 60}%" r="50%">
      <stop offset="0" stop-color="${hueB}" stop-opacity=".7"/><stop offset="1" stop-color="${hueB}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#lg)"/>
  <rect width="${w}" height="${h}" fill="url(#a)"/>
  <rect width="${w}" height="${h}" fill="url(#b)"/>
  ${circles}
  ${mark(w - 190, h - 190, 120, FG, 5)}
  <text x="60" y="${h - 70}" font-family="Arial, Helvetica, sans-serif" font-size="28" letter-spacing="3" fill="${FG}" fill-opacity=".8">${label}</text>
  <text x="60" y="${h - 30}" font-family="Arial, Helvetica, sans-serif" font-size="20" letter-spacing="2" fill="${FG}" fill-opacity=".55">IMAGEN DE EJEMPLO · [COMPLETAR]</text>
  <rect width="${w}" height="${h}" filter="url(#g)"/>
</svg>`;
};

const png = (svg, out) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
const jpg = (svg, out) => sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toFile(out);

await png(icon(32, { pad: 0.1, width: 10 }), 'public/favicon-32.png');
await png(icon(180, { radius: 0 }), 'public/apple-touch-icon.png');
await png(icon(192), 'public/icon-192.png');
await png(icon(512), 'public/icon-512.png');
await jpg(og, 'public/og-image.jpg');

const dir = 'src/assets/images/projects';
await mkdir(dir, { recursive: true });
const force = process.argv.includes('--placeholders');
for (let p = 1; p <= 4; p++) {
  const id = String(p).padStart(2, '0');
  const cover = `${dir}/proyecto-${id}-portada.jpg`;
  if (force || !existsSync(cover)) await jpg(placeholder(1600, 1100, p, `PROYECTO ${id} — PORTADA`), cover);
  for (let g = 1; g <= 3; g++) {
    const file = `${dir}/proyecto-${id}-galeria-${g}.jpg`;
    if (force || !existsSync(file)) await jpg(placeholder(1600, 1000, p * 10 + g, `PROYECTO ${id} — GALERÍA ${g}`), file);
  }
}
console.log('Recursos de marca generados.');
