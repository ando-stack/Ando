/**
 * Navegación: cabecera que se oculta al bajar y aparece al subir, menú móvil
 * a pantalla completa (animado y accesible), barra de progreso y "volver arriba".
 */
import { gsap } from './gsap';
import { effects } from './config';
import { prefersReducedMotion, type Cleanup } from './motion';
import { scrollToTarget, startScroll, stopScroll } from './smooth-scroll';

export function initHeader(): Cleanup {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return () => {};
  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const menuOpen = document.documentElement.classList.contains('menu-open');
    header.classList.toggle('is-scrolled', y > 24);
    if (!menuOpen) header.classList.toggle('is-hidden', y > 160 && y > lastY + 2);
    if (y < lastY - 2 || y <= 160) header.classList.remove('is-hidden');
    lastY = y;
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  // Si el foco entra en la cabecera oculta (teclado), mostrarla.
  const onFocus = () => header.classList.remove('is-hidden');
  window.addEventListener('scroll', onScroll, { passive: true });
  header.addEventListener('focusin', onFocus);
  update();
  return () => {
    window.removeEventListener('scroll', onScroll);
    header.removeEventListener('focusin', onFocus);
  };
}

export function initMobileMenu(): Cleanup {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!toggle || !menu) return () => {};
  const html = document.documentElement;
  const links = menu.querySelectorAll<HTMLElement>('[data-menu-link]');
  const extras = menu.querySelectorAll<HTMLElement>('[data-menu-extra]');
  const reduced = prefersReducedMotion();
  let open = false;
  let tl: gsap.core.Timeline | null = null;

  const focusables = () =>
    [toggle, ...menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
      (el) => !el.hasAttribute('hidden'),
    );

  const setOpen = (value: boolean, { focusToggle = true } = {}) => {
    if (open === value) return;
    open = value;
    toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-label', value ? 'Cerrar menú' : 'Abrir menú');
    html.classList.toggle('menu-open', value);
    tl?.kill();
    if (value) {
      menu.hidden = false;
      stopScroll();
      if (reduced) {
        gsap.set(menu, { clipPath: 'inset(0% 0% 0% 0%)' });
      } else {
        tl = gsap
          .timeline()
          .fromTo(menu, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'expo.inOut' })
          .fromTo(links, { yPercent: 110 }, { yPercent: 0, duration: 1, stagger: 0.06 }, '-=0.45')
          .fromTo(extras, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.05 }, '-=0.8');
      }
      links[0]?.focus({ preventScroll: true });
    } else {
      startScroll();
      const done = () => {
        menu.hidden = true;
      };
      if (reduced) done();
      else
        tl = gsap
          .timeline({ onComplete: done })
          .to(menu, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.7, ease: 'expo.inOut' });
      if (focusToggle) toggle.focus({ preventScroll: true });
    }
  };

  const onToggle = () => setOpen(!open);
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const onLinkClick = () => setOpen(false, { focusToggle: false });
  const onResize = () => {
    if (open && window.matchMedia('(min-width: 768px)').matches) setOpen(false, { focusToggle: false });
  };

  toggle.addEventListener('click', onToggle);
  document.addEventListener('keydown', onKey);
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', onLinkClick));
  window.addEventListener('resize', onResize);

  return () => {
    tl?.kill();
    if (open) {
      html.classList.remove('menu-open');
      startScroll();
    }
    toggle.removeEventListener('click', onToggle);
    document.removeEventListener('keydown', onKey);
    menu.querySelectorAll('a').forEach((a) => a.removeEventListener('click', onLinkClick));
    window.removeEventListener('resize', onResize);
  };
}

/** Barra de progreso de lectura (elemento persistente entre páginas). */
export function initScrollProgress() {
  const bar = document.querySelector<HTMLElement>('[data-scroll-progress]');
  if (!bar || !effects.scrollProgress) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('astro:page-load', update);
  update();
}

/** Botones/enlaces con data-scroll-top y enlaces internos (#seccion) con scroll suave. */
export function initScrollLinks(root: ParentNode = document): Cleanup {
  const tops = root.querySelectorAll<HTMLElement>('[data-scroll-top]');
  const onTop = (e: Event) => {
    e.preventDefault();
    scrollToTarget(0);
    // Devolver el foco al principio de la página para usuarios de teclado.
    document.getElementById('top')?.focus({ preventScroll: true });
  };
  tops.forEach((el) => el.addEventListener('click', onTop));
  return () => tops.forEach((el) => el.removeEventListener('click', onTop));
}
