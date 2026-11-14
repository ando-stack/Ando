/* ==========================================================================
   VYRO VISUALS — TU CONTENIDO
   --------------------------------------------------------------------------
   Este es el ÚNICO archivo que tienes que tocar para subir trabajos.

   1. Copia la imagen o el vídeo a su carpeta dentro de /media
      (por ejemplo: media/gfx/deportes/mi-post.jpg)
   2. Añade una línea en la lista correspondiente de abajo.
   3. Guarda. Lo más nuevo ponlo ARRIBA de la lista.

   Si una lista está vacía, la web muestra tarjetas de "Próximamente".
   ========================================================================== */

const VYRO = {
  // ---- Datos de contacto y redes (deja "" en las que no uses) ----
  perfil: {
    nombre: "Vyro Visuals",
    email: "",                                  // ej: "contacto@vyrovisuals.com"
    instagram: "",                              // ej: "https://instagram.com/vyrovisuals"
    twitter: "",                                // ej: "https://x.com/vyrovisuals"
    youtube: "",
    tiktok: "",
    discord: "",
  },

  /* ------------------------------------------------------------------------
     GFX — imágenes (jpg, png, webp, gif)
     { imagen: "ruta", titulo: "Nombre", cliente: "opcional", fecha: "opcional" }
     ------------------------------------------------------------------------ */
  gfx: {
    deportes: [
      // { imagen: "media/gfx/deportes/matchday.jpg", titulo: "Matchday Poster", cliente: "Club X" },
    ],
    gaming: [
      // { imagen: "media/gfx/gaming/header-twitch.png", titulo: "Header Twitch", cliente: "Streamer Y" },
    ],
    miniaturas: [
      // { imagen: "media/gfx/miniaturas/mini-1.jpg", titulo: "Miniatura YouTube", cliente: "Canal Z" },
    ],
  },

  /* ------------------------------------------------------------------------
     VFX y ANIMACIONES — vídeos
     Dos formas de añadir un vídeo:
       a) De YouTube:   { youtube: "ID_DEL_VIDEO", titulo: "..." }
          (el ID es lo que va después de watch?v=  o de /shorts/ )
       b) Archivo propio: { video: "media/vfx/largos/edit.mp4", portada: "media/vfx/largos/edit.jpg", titulo: "..." }
          (la portada es opcional)
     ------------------------------------------------------------------------ */
  vfx: {
    largos: [
      // { youtube: "dQw4w9WgXcQ", titulo: "Edit cinemático", cliente: "Canal Z" },
    ],
    shorts: [
      // { youtube: "ID_DEL_SHORT", titulo: "Short velocity" },
      // { video: "media/vfx/shorts/short1.mp4", titulo: "Short transiciones" },
    ],
  },

  animaciones: [
    // { video: "media/animaciones/intro-logo.mp4", titulo: "Intro de logo animado" },
    // { youtube: "ID_DEL_VIDEO", titulo: "Animación 3D" },
  ],
};
