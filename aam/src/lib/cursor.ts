/**
 * Cursor personalizado: un punto que sigue al ratón y un círculo con retraso.
 * Sobre enlaces/botones crece; con data-cursor="Texto" muestra ese texto.
 * Solo se activa con ratón (no en pantallas táctiles) y sin "reducir movimiento".
 */
import { gsap } from './gsap';
import { effects } from './config';
import { isTouchDevice, prefersReducedMotion } from './motion';

let initialized = false;

export function initCursor() {
  if (initialized || !effects.cursor || isTouchDevice() || prefersReducedMotion()) return;
  const root = document.getElementById('cursor');
  const dot = root?.querySelector<HTMLElement>('.cursor__dot');
  const ring = root?.querySelector<HTMLElement>('.cursor__ring');
  const label = root?.querySelector<HTMLElement>('.cursor__label');
  if (!root || !dot || !ring || !label) return;
  initialized = true;
  document.documentElement.classList.add('has-cursor');

  gsap.set([dot, ring], { xPercent: -50, yPercent: -50 });
  const dotX = gsap.quickTo(dot, 'x', { duration: 0.12, ease: 'power3' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.12, ease: 'power3' });
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.55, ease: 'power3' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.55, ease: 'power3' });

  let visible = false;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!visible) {
        visible = true;
        root.classList.add('is-visible');
        gsap.set([dot, ring], { x: e.clientX, y: e.clientY });
      }
      dotX(e.clientX);
      dotY(e.clientY);
      ringX(e.clientX);
      ringY(e.clientY);
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => {
    visible = false;
    root.classList.remove('is-visible');
  });
  window.addEventListener('pointerdown', () => root.classList.add('is-down'));
  window.addEventListener('pointerup', () => root.classList.remove('is-down'));

  const interactive = 'a, button, [data-cursor], input, textarea, select, label, summary';
  document.addEventListener('pointerover', (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>(interactive);
    if (!target) return;
    const text = target.dataset.cursor;
    const isField = target.matches('input, textarea, select');
    root.classList.toggle('is-text', isField);
    root.classList.toggle('is-hover', !isField);
    root.classList.toggle('has-label', Boolean(text));
    label.textContent = text || '';
  });
  document.addEventListener('pointerout', (e) => {
    const from = (e.target as Element | null)?.closest(interactive);
    const to = (e.relatedTarget as Element | null)?.closest(interactive);
    if (from && from !== to) {
      root.classList.remove('is-hover', 'has-label', 'is-text');
      label.textContent = '';
    }
  });
  // Al cambiar de página, reiniciar el estado del cursor.
  document.addEventListener('astro:after-swap', () => {
    root.classList.remove('is-hover', 'has-label', 'is-text', 'is-down');
    label.textContent = '';
  });
}
