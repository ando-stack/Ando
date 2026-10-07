# AAM — Portfolio de Andoni Ayala Malo

Web personal construida con **Astro** (sitio estático), **TypeScript**, **Tailwind CSS**, **React** (solo para el formulario de contacto), **GSAP + ScrollTrigger**, **Lenis** y **Three.js** (escena 3D del inicio).

> Todo el contenido personal es provisional y está marcado con **`[COMPLETAR]`**.
> Para encontrar todo lo que falta por rellenar:
>
> ```bash
> grep -rn "COMPLETAR" src/content astro.config.mjs
> ```

---

## 1. Requisitos

- **Node.js 22.12 o superior** (Astro 7 lo exige) — comprueba con `node -v`.
- **npm 9.6 o superior** — comprueba con `npm -v`.

Si no los tienes, instala la versión LTS desde <https://nodejs.org> (o con `nvm install 22`).

## 2. Instalación

```bash
cd aam
npm install
```

## 3. Arrancar en local

```bash
npm run dev        # servidor de desarrollo en http://localhost:4321
npm run build      # comprueba tipos y contenido, y genera la web en /dist
npm run preview    # sirve /dist para revisar la versión final
```

> El formulario de contacto solo envía mensajes una vez desplegado en Netlify. En local verás el mensaje de error (es lo esperado). Para probarlo en local puedes usar `npx netlify dev`.

## 4. Estructura

```
aam/
├─ public/                 favicon, iconos, imagen para redes (og-image.jpg), fuentes, monograma SVG
├─ scripts/
│  └─ generate-brand-assets.mjs   genera iconos PNG, imagen OG e imágenes de ejemplo (npm run brand)
├─ src/
│  ├─ assets/
│  │  ├─ logo/             monograma AAM (estático y versión animable con trazos separados)
│  │  └─ images/projects/  imágenes de los proyectos
│  ├─ components/
│  │  ├─ sections/         Hero, About, Services, Stack, Projects, Experience, Contact
│  │  ├─ three/HeroScene.ts  escena 3D del inicio
│  │  ├─ ContactForm.tsx   formulario (isla de React)
│  │  └─ Header, Footer, Logo, Preloader, ThemeToggle, SectionHeading…
│  ├─ content/             ← AQUÍ SE EDITA EL CONTENIDO
│  │  ├─ site.json         textos generales, servicios, stack, redes y contacto
│  │  ├─ projects/*.md     un archivo por proyecto
│  │  └─ experience/*.md   un archivo por etapa de tu trayectoria
│  ├─ content.config.ts    esquemas que validan el contenido
│  ├─ layouts/BaseLayout.astro   SEO, tema, transiciones, cursor, cortina
│  ├─ lib/                 GSAP, Lenis, animaciones, cursor, magnetismo, menú, precarga…
│  ├─ pages/               index, proyectos/[slug], 404, robots.txt
│  └─ styles/              tokens.css (diseño) y global.css
├─ astro.config.mjs
└─ netlify.toml
```

## 5. Editar el contenido

### Textos generales — `src/content/site.json`

| Campo | Dónde aparece |
| --- | --- |
| `name`, `brand` | Nombre y marca (cabecera, pie, SEO) |
| `role`, `tagline`, `location`, `availability` | Inicio |
| `email` | Contacto, menú móvil |
| `seo.title`, `seo.description` | Título y descripción de la página de inicio en Google/redes |
| `about.paragraphs` | Sobre mí (el primero aparece grande) |
| `about.photo`, `about.photoAlt` | Foto opcional (ver abajo) |
| `about.stats` | Datos con contador animado (`value`, `suffix`, `label`) |
| `services` | Tarjetas de servicios. Iconos: `code`, `design`, `motion`, `strategy`, `performance`, `spark` |
| `stack` | Cinta de tecnologías (con más de 6 se reparten en dos filas) |
| `contact.title`, `contact.intro` | Sección de contacto |
| `socials` | Redes (`label` + `url` completa con `https://`) |

**Añadir tu foto:** guarda la imagen en `src/assets/images/` (p. ej. `yo.jpg`) y añade dentro de `about`:

```json
"photo": "../assets/images/yo.jpg",
"photoAlt": "Retrato de Andoni Ayala Malo"
```

Astro la optimiza sola (WebP, varios tamaños, carga diferida). Si no hay foto se muestra un marcador.

### Proyectos — `src/content/projects/*.md`

Cada archivo es un proyecto y su nombre define la URL (`mi-proyecto.md` → `/proyectos/mi-proyecto`). Copia uno de los de ejemplo y cambia los campos:

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `title`, `summary`, `category`, `year`, `role` | sí | Datos básicos (la categoría alimenta el filtro) |
| `technologies` | sí | Lista de tecnologías |
| `cover`, `coverAlt` | no | Portada (ruta relativa a `src/assets/images/projects/`). Si falta, se muestra un marcador y el build avisa |
| `video` | no | Vídeo corto en `/public/videos/…mp4` (se usa en la portada y la vista previa) |
| `links.web`, `links.repo` | no | Enlaces externos |
| `challenge`, `solution`, `result` | sí | Desafío, solución y resultado (separa párrafos con una línea en blanco) |
| `gallery` | no | Lista de `{ src, alt }` |
| `order` | no | Orden (menor = antes) |
| `featured` | no | `false` para ocultarlo de la portada (sigue teniendo su página) |
| `draft` | no | `true` para no publicarlo |

El texto debajo del bloque `---` (opcional) se muestra en la sección «Solución».

Si falta un campo obligatorio, `npm run build` se detiene indicando el archivo y el campo.

### Experiencia — `src/content/experience/*.md`

Campos: `role`, `company`, `location` (opcional), `start`, `end` (por defecto «Actualidad») y `order` (menor = antes; pon primero lo más reciente). El texto bajo `---` es la descripción.

### Imágenes de ejemplo, iconos e imagen para redes

`npm run brand` regenera los iconos (favicon PNG, apple-touch-icon, icon-192/512) y `public/og-image.jpg` a partir del monograma. Las imágenes de ejemplo de proyectos solo se crean si no existen (`node scripts/generate-brand-assets.mjs --placeholders` las sobrescribe). Sustitúyelas por las tuyas manteniendo el nombre o cambiando la ruta en el `.md`.

## 6. Cambiar colores, fuentes y tamaños

Todo está en **`src/styles/tokens.css`**:

- **Colores**: bloque `:root` (tema oscuro, por defecto) y `:root[data-theme='light']` (tema claro). El acento es `--aam-accent`; `--aam-accent-ink` es la versión usada como color de texto (en el tema claro es más oscura para mantener el contraste). `--aam-scene-a/b` colorean la escena 3D.
- **Tipografías**: `--aam-font-display` (titulares, *Syne*) y `--aam-font-body` (texto, *Inter*). Para cambiarlas, copia los `.woff2` a `public/fonts/`, actualiza los `@font-face` del principio del archivo y las etiquetas `<link rel="preload">` de `src/layouts/BaseLayout.astro`. Ambas fuentes tienen licencia SIL OFL (incluida en `public/fonts/`).
- **Tamaños y espacios**: `--aam-text-*`, `--aam-gutter`, `--aam-section-y`, `--aam-radius-*`, tiempos `--aam-duration-*`.

El bloque `@theme inline` conecta estos tokens con Tailwind (`bg-bg`, `text-fg`, `text-accent-ink`…).

Si cambias el color del monograma o de la marca en los iconos, edita las constantes del principio de `scripts/generate-brand-assets.mjs` y `public/favicon.svg`, y ejecuta `npm run brand`.

## 7. Activar o desactivar efectos

Edita **`src/lib/config.ts`** y pon a `false` lo que quieras quitar:

```ts
export const effects = {
  preloader: true,       // pantalla de carga (solo 1.ª visita de la sesión)
  smoothScroll: true,    // Lenis
  cursor: true,          // cursor personalizado
  magnetic: true,        // botones magnéticos
  textReveal: true,      // revelado de textos
  imageReveal: true,     // máscara + parallax en imágenes
  tilt: true,            // inclinación 3D de tarjetas
  pageTransitions: true, // cortina con el monograma entre páginas
  scene3d: true,         // escena Three.js del inicio
  scrollProgress: true,  // barra de progreso
  grain: true,           // grano del fondo
};
```

Además, de forma automática:

- Con **«reducir movimiento»** activado en el sistema no hay scroll suave, 3D, cursor, precarga ni animaciones grandes: el contenido aparece directamente.
- En **pantallas táctiles** no hay cursor ni efectos de ratón; la escena 3D arranca con la primera interacción.
- En dispositivos modestos (poca memoria, ahorro de datos, 2G) o **sin WebGL** se muestra un fondo estático.
- Si **JavaScript falla**, todo el contenido sigue visible (las animaciones solo ocultan elementos cuando JS está activo, y hay un respaldo a los 6 s).

Para añadir animaciones a nuevos elementos basta con atributos: `data-split="lines|words|chars"`, `data-reveal="up|fade"`, `data-reveal-img`, `data-parallax="0.15"`, `data-count-to="42"`, `data-magnetic`, `data-tilt`, `data-cursor="Texto"` (ver `src/lib/animations.ts`).

## 8. Desplegar en Netlify

1. Sube el repositorio a GitHub/GitLab/Bitbucket.
2. En Netlify: **Add new site → Import an existing project** y elige el repositorio.
3. Como el proyecto está en la carpeta `aam/`, indica **Base directory: `aam`**. El resto lo lee de `netlify.toml` (comando `npm run build`, carpeta `dist`, Node 22).
4. Despliega. Netlify define la variable `URL` y se usa para las URL canónicas, el sitemap y las imágenes para redes. Si usas un dominio propio, añádelo en **Domain management** y (opcional) define la variable `SITE_URL` con él.

Alternativa por terminal:

```bash
npm install -g netlify-cli
netlify deploy --build          # borrador
netlify deploy --build --prod   # producción
```

## 9. Formulario de contacto (Netlify Forms)

- El formulario se llama **`contacto`** y tiene validación en el navegador y protección antispam con campo trampa (`bot-field`, honeypot).
- La primera vez, comprueba en Netlify **Site configuration → Forms** que la detección de formularios está activada (**Enable form detection**) y vuelve a desplegar.
- **Ver los mensajes:** panel de Netlify → tu sitio → **Forms** → `contacto`.
- **Recibirlos por email:** **Site configuration → Notifications → Emails and webhooks → Form submission notifications → Add notification → Email notification**.
- Los envíos marcados como spam aparecen en la pestaña *Spam* del mismo formulario.

## 10. Calidad

- `npm run build` ejecuta `astro check` (tipos y esquemas de contenido) antes de compilar.
- Lighthouse (móvil) en local: Rendimiento 99 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 en inicio y proyectos.
