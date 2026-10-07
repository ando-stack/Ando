/**
 * Punto de entrada del JavaScript del sitio.
 * - Una sola vez: scroll suave, cursor, barra de progreso, transiciones y precarga.
 * - En cada página (astro:page-load): animaciones, magnetismo, menú, etc.
 * - Antes de cambiar de página (astro:before-swap): se limpia todo para evitar fugas de memoria.
 */
import { ScrollTrigger } from './gsap';
import { initSmoothScroll, getLenis } from './smooth-scroll';
import { initCursor } from './cursor';
import { initMagnetic } from './magnetic';
import { initTilt } from './tilt';
import { initPageAnimations } from './animations';
import { initHeader, initMobileMenu, initScrollLinks, initScrollProgress } from './nav';
import { initThemeToggle } from './theme';
import { initPageTransitions } from './transitions';
import { runPreloader } from './preloader';
import { initProjects } from './projects';
import { initHeroScene } from './scene';
import type { Cleanup } from './motion';

let cleanups: Cleanup[] = [];
let firstLoad = true;
let pageToken = 0;

function runCleanups() {
  pageToken++;
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[AAM] Error al limpiar efectos', error);
    }
  });
  cleanups = [];
  ScrollTrigger.getAll().forEach((st) => st.kill());
}

/** Cede el hilo principal al navegador entre tareas para evitar bloqueos largos. */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function initPage() {
  runCleanups();
  const token = ++pageToken;
  const main = document.getElementById('main') || document.body;
  // Lo imprescindible primero; el resto, en tareas cortas separadas.
  const steps: Array<() => Cleanup> = [
    initThemeToggle,
    initHeader,
    initMobileMenu,
    initScrollLinks,
    () => initPageAnimations(main),
    initMagnetic,
    initTilt,
    initProjects,
    initHeroScene,
  ];
  for (const step of steps) {
    if (token !== pageToken) return; // se ha cambiado de página mientras tanto
    cleanups.push(step());
    if (firstLoad && step === initScrollLinks) void runPreloaderOnce();
    await yieldToMain();
  }
  // Año actual automático en el pie de página.
  document.querySelectorAll('[data-current-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });

  const lenis = getLenis();
  if (lenis) {
    lenis.resize();
    if (location.hash) {
      const target = document.querySelector<HTMLElement>(decodeURIComponent(location.hash));
      if (target) lenis.scrollTo(target, { immediate: true, offset: -80 });
    }
  }
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

function runPreloaderOnce() {
  if (!firstLoad) return;
  firstLoad = false;
  return runPreloader();
}

initSmoothScroll();
initCursor();
initScrollProgress();
initPageTransitions();

document.addEventListener('astro:page-load', () => void initPage());
document.addEventListener('astro:before-swap', runCleanups);
