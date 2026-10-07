/**
 * Interruptores de efectos. Pon cualquiera a `false` para desactivarlo en toda la web.
 * (Con "reducir movimiento" activado en el sistema, los efectos grandes se desactivan solos.)
 */
export const effects = {
  /** Pantalla de carga con el monograma (solo la primera visita de la sesión). */
  preloader: true,
  /** Scroll suave con Lenis. */
  smoothScroll: true,
  /** Cursor personalizado (punto + círculo). Nunca se muestra en pantallas táctiles. */
  cursor: true,
  /** Botones y enlaces magnéticos. */
  magnetic: true,
  /** Revelado de textos por líneas, palabras o letras. */
  textReveal: true,
  /** Revelado de imágenes con máscara y parallax. */
  imageReveal: true,
  /** Inclinación 3D de las tarjetas de servicios. */
  tilt: true,
  /** Cortina animada con el monograma al cambiar de página. */
  pageTransitions: true,
  /** Escena 3D interactiva del inicio (Three.js). */
  scene3d: true,
  /** Barra de progreso de lectura. */
  scrollProgress: true,
  /** Grano sutil sobre el fondo. */
  grain: true,
} as const;

/** Nombre de la clave de sessionStorage que recuerda si ya se vio la precarga. */
export const PRELOADER_KEY = 'aam-preloader-seen';
/** Nombre de la clave de localStorage para el tema (claro/oscuro). */
export const THEME_KEY = 'aam-theme';
