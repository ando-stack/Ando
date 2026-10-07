/**
 * Proyectos destacados:
 *  - Filtro por categoría con transición animada (GSAP Flip).
 *  - Vista previa flotante que sigue al cursor al pasar por cada proyecto (solo con ratón).
 */
import { gsap, Flip } from './gsap';
import { isTouchDevice, prefersReducedMotion, type Cleanup } from './motion';

export function initProjects(root: ParentNode = document): Cleanup {
  const section = root.querySelector<HTMLElement>('[data-projects]');
  if (!section) return () => {};
  const offs: Cleanup[] = [];
  const reduced = prefersReducedMotion();

  // ---------- Filtro ----------
  const buttons = section.querySelectorAll<HTMLButtonElement>('[data-filter]');
  const items = Array.from(section.querySelectorAll<HTMLElement>('[data-project]'));
  const status = section.querySelector<HTMLElement>('[data-filter-status]');

  const applyFilter = (value: string) => {
    const state = Flip.getState(items);
    let visible = 0;
    items.forEach((item) => {
      const show = value === 'all' || item.dataset.category === value;
      item.hidden = !show;
      if (show) visible++;
    });
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === value)));
    if (status) status.textContent = `${visible} ${visible === 1 ? 'proyecto' : 'proyectos'}`;
    if (reduced) return;
    Flip.from(state, {
      duration: 0.7,
      ease: 'expo.inOut',
      absolute: true,
      nested: true,
      onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.05 }),
      onLeave: (els) => gsap.to(els, { autoAlpha: 0, y: -20, duration: 0.4 }),
    });
  };
  buttons.forEach((btn) => {
    const onClick = () => applyFilter(btn.dataset.filter || 'all');
    btn.addEventListener('click', onClick);
    offs.push(() => btn.removeEventListener('click', onClick));
  });

  // ---------- Vista previa que sigue al cursor ----------
  const preview = section.querySelector<HTMLElement>('[data-project-preview]');
  if (preview && !isTouchDevice() && !reduced) {
    const media = Array.from(preview.querySelectorAll<HTMLElement>('[data-preview-item]'));
    section.classList.add('has-preview');
    gsap.set(preview, { xPercent: -50, yPercent: -50, scale: 0.6, autoAlpha: 0 });
    const xTo = gsap.quickTo(preview, 'x', { duration: 0.7, ease: 'power3' });
    const yTo = gsap.quickTo(preview, 'y', { duration: 0.7, ease: 'power3' });
    const rTo = gsap.quickTo(preview, 'rotation', { duration: 0.9, ease: 'power3' });
    const sTo = gsap.quickTo(preview, 'skewX', { duration: 0.9, ease: 'power3' });
    let lastX = 0;
    let active = '';

    const show = (slug: string) => {
      if (slug !== active) {
        media.forEach((m) => {
          const on = m.dataset.previewItem === slug;
          gsap.to(m, { autoAlpha: on ? 1 : 0, scale: on ? 1 : 1.15, duration: 0.6, ease: 'expo.out' });
          const video = m.querySelector('video');
          if (video) on ? video.play().catch(() => {}) : video.pause();
        });
        active = slug;
      }
      gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.6, ease: 'expo.out' });
    };
    const hide = () => {
      gsap.to(preview, { autoAlpha: 0, scale: 0.6, duration: 0.5, ease: 'expo.out' });
      rTo(0);
      sTo(0);
    };
    const move = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      xTo(e.clientX);
      yTo(e.clientY);
      // Inclinación y ligera distorsión según la velocidad horizontal.
      rTo(gsap.utils.clamp(-12, 12, dx * 0.6));
      sTo(gsap.utils.clamp(-10, 10, dx * 0.4));
    };

    items.forEach((item) => {
      const link = item.querySelector<HTMLElement>('[data-project-link]');
      if (!link) return;
      const enter = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        if (!preview.style.transform.includes('translate')) gsap.set(preview, { x: e.clientX, y: e.clientY });
        lastX = e.clientX;
        show(item.dataset.slug || '');
      };
      link.addEventListener('pointerenter', enter);
      link.addEventListener('pointermove', move);
      link.addEventListener('pointerleave', hide);
      offs.push(() => {
        link.removeEventListener('pointerenter', enter);
        link.removeEventListener('pointermove', move);
        link.removeEventListener('pointerleave', hide);
      });
    });
    offs.push(() => {
      gsap.killTweensOf([preview, ...media]);
      section.classList.remove('has-preview');
    });
  }

  return () => offs.forEach((off) => off());
}
