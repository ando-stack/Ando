/** Inclinación 3D de tarjetas al pasar el ratón (data-tilt), con un brillo que sigue al cursor. */
import { gsap } from './gsap';
import { effects } from './config';
import { isTouchDevice, prefersReducedMotion, type Cleanup } from './motion';

export function initTilt(root: ParentNode = document): Cleanup {
  if (!effects.tilt || isTouchDevice() || prefersReducedMotion()) return () => {};
  const offs: Cleanup[] = [];

  root.querySelectorAll<HTMLElement>('[data-tilt]').forEach((card) => {
    const max = Number(card.dataset.tilt || 10);
    gsap.set(card, { transformPerspective: 900, transformStyle: 'preserve-3d' });
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3' });

    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      ry((px - 0.5) * max * 2);
      rx((0.5 - py) * max * 2);
      card.style.setProperty('--glare-x', `${px * 100}%`);
      card.style.setProperty('--glare-y', `${py * 100}%`);
    };
    const leave = () => {
      rx(0);
      ry(0);
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', leave);
    offs.push(() => {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerleave', leave);
      gsap.killTweensOf(card);
      gsap.set(card, { clearProps: 'transform' });
    });
  });

  return () => offs.forEach((off) => off());
}
