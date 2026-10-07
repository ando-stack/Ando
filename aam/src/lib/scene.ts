/**
 * Carga diferida de la escena 3D del inicio.
 * Three.js solo se descarga en la página de inicio, después de que el contenido
 * principal esté listo, y solo si el dispositivo puede con ello. En caso contrario
 * (o si WebGL no está disponible) se queda el fondo estático, sin errores.
 */
import { effects } from './config';
import { introDone, isTouchDevice, prefersReducedMotion, whenIdle, type Cleanup } from './motion';

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

function isLowEndDevice(): boolean {
  const nav = navigator as NavigatorWithHints;
  if (nav.connection?.saveData) return true;
  if (nav.connection?.effectiveType && /(^|-)2g$/.test(nav.connection.effectiveType)) return true;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return true;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency < 4) return true;
  return false;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const ok = Boolean(gl);
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

export function initHeroScene(root: ParentNode = document): Cleanup {
  const host = root.querySelector<HTMLElement>('[data-hero-scene]');
  if (!host || !effects.scene3d || prefersReducedMotion() || isLowEndDevice()) return () => {};

  let disposed = false;
  let dispose: Cleanup | null = null;
  let cancelIdle: Cleanup | null = null;

  const start = async () => {
    if (disposed || !hasWebGL()) return;
    try {
      const { createHeroScene } = await import('../components/three/HeroScene');
      if (disposed) return;
      dispose = createHeroScene(host);
      host.classList.add('is-ready');
    } catch {
      // Sin 3D: se mantiene el fondo estático.
      host.classList.remove('is-ready');
    }
  };

  // En pantallas táctiles (móviles) la escena arranca con la primera interacción
  // o pasados unos segundos, para no competir con la carga inicial.
  const touch = isTouchDevice();
  const interactionEvents = ['pointerdown', 'touchstart', 'scroll', 'keydown'] as const;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  const removeInteraction = () => {
    interactionEvents.forEach((ev) => window.removeEventListener(ev, onInteraction));
    clearTimeout(waitTimer);
  };
  function onInteraction() {
    removeInteraction();
    cancelIdle = whenIdle(() => void start(), 1000);
  }
  const schedule = () => {
    if (!touch) {
      cancelIdle = whenIdle(() => void start(), 3000);
      return;
    }
    interactionEvents.forEach((ev) => window.addEventListener(ev, onInteraction, { once: true, passive: true }));
    waitTimer = setTimeout(onInteraction, 7000);
  };
  const afterLoad = () => introDone.then(() => setTimeout(schedule, 400));
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad, { once: true });

  return () => {
    disposed = true;
    cancelIdle?.();
    removeInteraction();
    window.removeEventListener('load', afterLoad);
    dispose?.();
    dispose = null;
  };
}
