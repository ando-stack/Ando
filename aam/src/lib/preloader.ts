/**
 * Precarga: el monograma AAM se dibuja trazo a trazo mientras un contador va de 0 a 100;
 * después, una cortina se retira hacia arriba y empieza la animación del inicio.
 * Solo se muestra en la primera visita de la sesión (sessionStorage).
 */
import { gsap } from './gsap';
import { PRELOADER_KEY } from './config';
import { finishIntro } from './motion';
import { startScroll, stopScroll } from './smooth-scroll';

export async function runPreloader(): Promise<void> {
  const html = document.documentElement;
  const el = document.querySelector<HTMLElement>('[data-preloader]');
  if (!el || !html.classList.contains('show-preloader')) {
    finishIntro();
    return;
  }
  try {
    sessionStorage.setItem(PRELOADER_KEY, '1');
  } catch {
    /* sin almacenamiento: se mostrará en cada carga completa */
  }

  stopScroll();
  const strokes = el.querySelectorAll<SVGPathElement>('.aam-stroke');
  const counter = el.querySelector<HTMLElement>('[data-preloader-count]');
  const bar = el.querySelector<HTMLElement>('[data-preloader-bar]');
  const progress = { value: 0 };

  await new Promise<void>((resolve) => {
    const tl = gsap.timeline({ onComplete: resolve });
    tl.to(strokes, { strokeDashoffset: 0, duration: 0.9, stagger: 0.1, ease: 'power2.inOut' }, 0)
      .to(
        progress,
        {
          value: 100,
          duration: 1.5,
          ease: 'power2.inOut',
          onUpdate: () => {
            const v = Math.round(progress.value);
            if (counter) counter.textContent = String(v).padStart(3, '0');
            if (bar) bar.style.transform = `scaleX(${v / 100})`;
          },
        },
        0,
      )
      .to(el.querySelector('.preloader__mark'), { scale: 0.9, duration: 0.5, ease: 'power2.in' }, '>-0.1');
  });

  await new Promise<void>((resolve) => {
    gsap
      .timeline({
        onComplete: () => {
          html.classList.remove('show-preloader');
          el.setAttribute('hidden', '');
          resolve();
        },
      })
      .to(el.querySelectorAll('.preloader__inner > *'), { autoAlpha: 0, y: -30, duration: 0.5, stagger: 0.04, ease: 'power2.in' })
      .to(el, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'expo.inOut' }, '-=0.15')
      .add(() => {
        startScroll();
        finishIntro();
      }, '-=0.55');
  });
}
