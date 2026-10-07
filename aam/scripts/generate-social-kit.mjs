/**
 * Kit de marca para redes sociales (AAM): fotos de perfil, logo horizontal,
 * marca de agua para vídeos y portadas de YouTube y X/Twitter.
 *
 * Uso: node scripts/generate-social-kit.mjs  → archivos en brand/redes/
 * Los textos usan la fuente Syne (ExtraBold) e Inter; deben estar instaladas en el
 * sistema para regenerar las imágenes (están en public/fonts, licencia OFL).
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const OUT = 'brand/redes';
const BG = '#0B0B0C';
const FG = '#EDEDE8';
const LIME = '#C8FF2E';
const VIOLET = '#6D5DFC';
const DISPLAY = "'Syne AAM', 'Syne', 'Arial Black', sans-serif";
const BODY = "'Inter', Arial, sans-serif";

const strokes = `<path d="M12 11V89"/><path d="M12 78L31 22L50 78L69 22L88 78"/><path d="M17.4 62H44.6"/><path d="M55.4 62H82.6"/><path d="M88 11V89"/>`;
const mark = (cx, cy, size, color, width = 7) =>
  `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="miter" stroke-miterlimit="10">${strokes}</g>`;
const glow = (id, cx, cy, r, color, op) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
const svg = (w, h, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const save = (s, name) => sharp(Buffer.from(s)).png({ compressionLevel: 9 }).toFile(`${OUT}/${name}`);

await mkdir(OUT, { recursive: true });

// ---------- Fotos de perfil (1080×1080, seguras para recorte circular) ----------
await save(
  svg(1080, 1080, `<rect width="1080" height="1080" fill="${BG}"/><rect width="1080" height="1080" fill="url(#g)"/>${mark(540, 540, 560, LIME, 7)}`,
    glow('g', '50%', '45%', '60%', VIOLET, 0.2)),
  'perfil-oscuro.png',
);
await save(svg(1080, 1080, `<rect width="1080" height="1080" fill="${LIME}"/>${mark(540, 540, 560, BG, 7)}`), 'perfil-lima.png');
await save(svg(1080, 1080, `<rect width="1080" height="1080" fill="#F2F1EC"/>${mark(540, 540, 560, BG, 7)}`), 'perfil-claro.png');

// ---------- Logo horizontal (fondo transparente) ----------
const horizontal = (color, accent, sub) =>
  svg(2000, 600, `${mark(300, 300, 360, accent, 7)}
    <text x="560" y="345" font-family="${DISPLAY}" font-size="250" letter-spacing="-6" fill="${color}">AAM</text>
    <text x="568" y="430" font-family="${BODY}" font-weight="500" font-size="44" letter-spacing="10" fill="${sub}">CONTENIDO CON IA</text>`);
await save(horizontal(FG, LIME, '#A3A39C'), 'logo-horizontal-para-fondo-oscuro.png');
await save(horizontal(BG, BG, '#54544E'), 'logo-horizontal-para-fondo-claro.png');

// ---------- Monograma suelto (transparente) ----------
await save(svg(1000, 1000, mark(500, 500, 860, LIME, 7)), 'monograma-lima.png');
await save(svg(1000, 1000, mark(500, 500, 860, BG, 7)), 'monograma-negro.png');
await save(svg(1000, 1000, mark(500, 500, 860, '#FFFFFF', 7)), 'monograma-blanco.png');

// ---------- Marca de agua para vídeos (blanco semitransparente) ----------
await save(svg(400, 400, `<g opacity="0.55">${mark(200, 200, 340, '#FFFFFF', 8)}</g>`), 'marca-de-agua-videos.png');

// ---------- Portada de YouTube (2560×1440; zona segura central 1546×423) ----------
await save(
  svg(2560, 1440, `<rect width="2560" height="1440" fill="${BG}"/><rect width="2560" height="1440" fill="url(#g)"/>
    <g stroke="${FG}" stroke-opacity=".08"><path d="M507 0V1440M2053 0V1440M0 508H2560M0 932H2560"/></g>
    ${mark(800, 720, 250, LIME, 7)}
    <text x="960" y="735" font-family="${DISPLAY}" font-size="150" letter-spacing="-4" fill="${FG}">AAM</text>
    <text x="966" y="812" font-family="${BODY}" font-weight="500" font-size="34" letter-spacing="4" fill="#A3A39C">CONTENIDO CON IA · CREADORES Y NEGOCIOS</text>`,
    glow('g', '70%', '50%', '45%', VIOLET, 0.3)),
  'portada-youtube.png',
);

// ---------- Portada de X/Twitter (1500×500) — también sirve para Facebook/LinkedIn ----------
await save(
  svg(1500, 500, `<rect width="1500" height="500" fill="${BG}"/><rect width="1500" height="500" fill="url(#g)"/>
    ${mark(530, 225, 170, LIME, 7)}
    <text x="660" y="235" font-family="${DISPLAY}" font-size="60" letter-spacing="-2" fill="${FG}">Contenido con IA</text>
    <text x="663" y="285" font-family="${BODY}" font-weight="500" font-size="22" letter-spacing="4" fill="#A3A39C">VÍDEO · REDES · SHORTS · MINIATURAS · WEBS</text>`,
    glow('g', '85%', '50%', '40%', VIOLET, 0.35)),
  'portada-x-twitter.png',
);

console.log('Kit de redes generado en', OUT);
