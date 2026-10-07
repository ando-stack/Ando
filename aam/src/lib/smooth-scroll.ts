/** Scroll suave con Lenis, sincronizado con ScrollTrigger mediante el ticker de GSAP. */
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from './gsap';
import { effects } from './config';
import { prefersReducedMotion } from './motion';

let lenis: Lenis | null = null;

export function initSmoothScroll(): Lenis | null {
  if (lenis || !effects.smoothScroll || prefersReducedMotion()) return lenis;
  lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    anchors: { offset: -80 },
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export const getLenis = () => lenis;

export function scrollToTarget(target: number | string | HTMLElement, immediate = false) {
  if (lenis) {
    lenis.scrollTo(target, { immediate, offset: typeof target === 'number' ? 0 : -80 });
    return;
  }
  const behavior: ScrollBehavior = immediate || prefersReducedMotion() ? 'auto' : 'smooth';
  if (typeof target === 'number') window.scrollTo({ top: target, behavior });
  else {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    el?.scrollIntoView({ behavior });
  }
}

export const stopScroll = () => {
  lenis?.stop();
  document.documentElement.classList.add('scroll-locked');
};
export const startScroll = () => {
  lenis?.start();
  document.documentElement.classList.remove('scroll-locked');
};
