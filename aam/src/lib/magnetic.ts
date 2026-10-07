/** Botones y enlaces magnéticos: el elemento se desplaza ligeramente hacia el cursor. */
import { gsap } from './gsap';
import { effects } from './config';
import { isTouchDevice, prefersReducedMotion, type Cleanup } from './motion';

export function initMagnetic(root: ParentNode = document): Cleanup {
  if (!effects.magnetic || isTouchDevice() || prefersReducedMotion()) return () => {};
  const offs: Cleanup[] = [];

  root.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
    const strength = Number(el.dataset.magnetic || 0.35);
    const inner = el.querySelector<HTMLElement>('[data-magnetic-inner]');
    const xTo = gsap.quickTo(el, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.4)' });
    const ixTo = inner ? gsap.quickTo(inner, 'x', { duration: 0.8, ease: 'elastic.out(1, 0.4)' }) : null;
    const iyTo = inner ? gsap.quickTo(inner, 'y', { duration: 0.8, ease: 'elastic.out(1, 0.4)' }) : null;

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      xTo(dx * strength);
      yTo(dy * strength);
      ixTo?.(dx * strength * 0.5);
      iyTo?.(dy * strength * 0.5);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
      ixTo?.(0);
      iyTo?.(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    offs.push(() => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      gsap.killTweensOf(inner ? [el, inner] : el);
      gsap.set(inner ? [el, inner] : el, { clearProps: 'transform' });
    });
  });

  return () => offs.forEach((off) => off());
}
