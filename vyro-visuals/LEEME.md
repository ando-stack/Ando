# Vyro Visuals — web portfolio

Web estática (HTML + CSS + JS, sin instalar nada). Abre `index.html` en el navegador para verla.

## Secciones
- **GFX** → Deportes · Gaming · Miniaturas
- **VFX** → Vídeos largos · Shorts
- **Animaciones**
- **Contacto**

## Cómo subir un trabajo nuevo
1. Copia el archivo a su carpeta:
   - `media/gfx/deportes/`, `media/gfx/gaming/`, `media/gfx/miniaturas/`
   - `media/vfx/largos/`, `media/vfx/shorts/`
   - `media/animaciones/`
2. Abre `contenido.js` y añade una línea en la lista que toque (arriba = lo más nuevo):

```js
// Imagen GFX
{ imagen: "media/gfx/deportes/matchday.jpg", titulo: "Matchday Poster", cliente: "Club X" },

// Vídeo de YouTube (el ID es lo que va tras watch?v= o /shorts/)
{ youtube: "ID_DEL_VIDEO", titulo: "Edit cinemático" },

// Vídeo propio (mp4) con portada opcional
{ video: "media/animaciones/intro.mp4", portada: "media/animaciones/intro.jpg", titulo: "Intro logo" },
```

3. En `perfil` (arriba del mismo archivo) pon tu email y redes para que salgan los botones de contacto.

Consejo: para vídeos largos usa YouTube (los mp4 pesados ralentizan la web). Para imágenes, `.jpg`/`.webp` de menos de ~1 MB.

## Publicarla gratis
Sube la carpeta `vyro-visuals` a Netlify (arrastrar y soltar en app.netlify.com/drop), Vercel o GitHub Pages.
