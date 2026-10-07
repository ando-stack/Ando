/**
 * Transiciones entre páginas: Astro View Transitions (ClientRouter) + una cortina
 * con el monograma AAM que cubre la pantalla mientras se carga la página nueva.
 */
import { gsap } from './gsap';
import { effects } from './config';
import { prefersReducedMotion } from './motion';

let initialized = false;
let covering = false;

export function initPageTransitions() {
  if (initialized) return;
  initialized = true;
  const curtain = document.querySelector<HTMLElement>('[data-curtain]');
  if (!curtain || !effects.pageTransitions) return;

  document.addEventListener('astro:before-preparation', (event) => {
    if (prefersReducedMotion()) return;
    // Los cambios dentro de la misma página (anclas) no necesitan cortina.
    if (event.from.pathname === event.to.pathname) return;
    const originalLoader = event.loader;
    event.loader = async () => {
      covering = true;
      curtain.hidden = false;
      const cover = gsap
        .timeline()
        .fromTo(curtain, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'expo.inOut' })
        .fromTo(curtain.querySelectorAll('.aam-stroke'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, stagger: 0.05, ease: 'power2.inOut' }, 0.25);
      await Promise.all([cover.then(), originalLoader()]);
    };
  });

  document.addEventListener('astro:page-load', () => {
    if (!covering) return;
    covering = false;
    gsap
      .timeline({ onComplete: () => (curtain.hidden = true) })
      .to(curtain, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.8, ease: 'expo.inOut', delay: 0.05 });
  });
}
