/** Utilidades de entorno para decidir qué efectos se pueden ejecutar. */

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Dispositivo sin ratón (pantalla táctil). */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches;

/** Ejecuta una función cuando el navegador esté libre (con respaldo para Safari). */
export const whenIdle = (fn: () => void, timeout = 2000): (() => void) => {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
};

/** Una función de limpieza que se ejecuta al salir de una página. */
export type Cleanup = () => void;

/** Promesa que se resuelve cuando termina la intro (precarga). */
let resolveIntro: () => void;
export const introDone = new Promise<void>((resolve) => {
  resolveIntro = resolve;
});
export const finishIntro = () => resolveIntro();
