/**
 * Animaciones de página basadas en atributos data-*:
 *
 *   data-split="lines|words|chars"   Revelado de texto al entrar en pantalla.
 *   data-split-intro                  …o al terminar la precarga (para el inicio).
 *   data-reveal="up|fade"             Aparición suave de bloques.
 *   data-reveal-img                   Revelado de imagen con máscara (+ zoom del contenido).
 *   data-parallax="0.15"              Desplazamiento parallax (fracción de la altura).
 *   data-count-to="42"                Contador animado.
 *   data-timeline                     Línea de tiempo que se dibuja con el scroll.
 *
 * Todo se crea dentro de un gsap.context() para poder revertirlo al cambiar de página.
 */
import { gsap, ScrollTrigger, SplitText } from './gsap';
import { effects } from './config';
import { introDone, prefersReducedMotion, type Cleanup } from './motion';

export function initPageAnimations(root: HTMLElement = document.body): Cleanup {
  const html = document.documentElement;
  if (prefersReducedMotion()) {
    // Sin animaciones grandes: los contadores muestran su valor final directamente.
    root.querySelectorAll<HTMLElement>('[data-count-to]').forEach((el) => {
      el.textContent = formatCount(Number(el.dataset.countTo), el);
    });
    return () => {};
  }

  const splits: SplitText[] = [];

  const createSplit = (el: HTMLElement) => {
    const type = (el.dataset.split || 'lines') as 'lines' | 'words' | 'chars';
    const isIntro = el.hasAttribute('data-split-intro');
    const delay = Number(el.dataset.splitDelay || 0);
    const split = SplitText.create(el, {
      type: type === 'chars' ? 'words,chars' : type === 'words' ? 'lines,words' : 'lines',
      mask: type === 'chars' ? 'words' : 'lines',
      linesClass: 'split-line',
      // En titulares, el lector de pantalla lee el texto completo (aria-label);
      // en párrafos se deja el texto tal cual para no usar ARIA no permitido.
      aria: /^H[1-6]$/.test(el.tagName) ? 'auto' : 'none',
      autoSplit: type === 'lines',
      onSplit(self) {
        el.classList.add('is-split');
        const targets = type === 'chars' ? self.chars : type === 'words' ? self.words : self.lines;
        const tween = gsap.from(targets, {
          yPercent: 110,
          rotate: type === 'chars' ? 6 : 0,
          duration: type === 'chars' ? 1.2 : 1.1,
          stagger: type === 'chars' ? 0.025 : type === 'words' ? 0.04 : 0.09,
          delay,
          paused: isIntro,
          scrollTrigger: isIntro ? undefined : { trigger: el, start: 'top 88%', once: true },
        });
        if (isIntro) introDone.then(() => tween.play());
        return tween;
      },
    });
    splits.push(split);
  };

  // Los textos de la intro se dividen ya; el resto, justo antes de entrar en pantalla
  // (así no se bloquea el hilo principal al cargar la página).
  const lazySplit = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        lazySplit.unobserve(entry.target);
        ctx.add(() => createSplit(entry.target as HTMLElement));
      });
    },
    { rootMargin: '0px 0px 30% 0px' },
  );

  const ctx = gsap.context(() => {
    // ---------- Textos ----------
    root.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
      if (!effects.textReveal) {
        el.classList.add('is-split');
        return;
      }
      if (el.hasAttribute('data-split-intro')) createSplit(el);
      else lazySplit.observe(el);
    });

    // ---------- Bloques ----------
    const blocks = gsap.utils.toArray<HTMLElement>('[data-reveal]', root);
    if (blocks.length) {
      ScrollTrigger.batch(blocks, {
        start: 'top 90%',
        once: true,
        onEnter: (batch) =>
          gsap.fromTo(
            batch,
            { autoAlpha: 0, y: (_i, el: HTMLElement) => (el.dataset.reveal === 'up' ? 40 : 0) },
            { autoAlpha: 1, y: 0, duration: 1.1, stagger: 0.08, overwrite: true },
          ),
      });
    }

    // ---------- Imágenes ----------
    gsap.utils.toArray<HTMLElement>('[data-reveal-img]', root).forEach((wrap) => {
      if (!effects.imageReveal) {
        gsap.set(wrap, { clipPath: 'inset(0% 0 0 0)' });
        return;
      }
      const inner = wrap.querySelector('img, video, .media-placeholder');
      const tl = gsap.timeline({
        scrollTrigger: { trigger: wrap, start: 'top 85%', once: true },
        defaults: { duration: 1.4, ease: 'expo.inOut' },
      });
      tl.fromTo(wrap, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' });
      if (inner) tl.fromTo(inner, { scale: 1.35 }, { scale: 1, duration: 1.8, ease: 'expo.out' }, 0);
    });

    if (effects.imageReveal) {
      gsap.utils.toArray<HTMLElement>('[data-parallax]', root).forEach((el) => {
        const amount = Number(el.dataset.parallax || 0.12) * 100;
        gsap.fromTo(
          el,
          { yPercent: -amount / 2 },
          {
            yPercent: amount / 2,
            ease: 'none',
            scrollTrigger: { trigger: el.parentElement || el, start: 'top bottom', end: 'bottom top', scrub: true },
          },
        );
      });
    }

    // ---------- Contadores ----------
    gsap.utils.toArray<HTMLElement>('[data-count-to]', root).forEach((el) => {
      const target = Number(el.dataset.countTo);
      const counter = { value: 0 };
      el.textContent = formatCount(0, el);
      gsap.to(counter, {
        value: target,
        duration: 2.2,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        onUpdate: () => {
          el.textContent = formatCount(counter.value, el);
        },
      });
    });

    // ---------- Línea de tiempo ----------
    gsap.utils.toArray<HTMLElement>('[data-timeline]', root).forEach((tlEl) => {
      const line = tlEl.querySelector<HTMLElement>('[data-timeline-line]');
      if (line) {
        gsap.fromTo(
          line,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: 'none',
            scrollTrigger: { trigger: tlEl, start: 'top 70%', end: 'bottom 60%', scrub: 0.6 },
          },
        );
      }
      tlEl.querySelectorAll<HTMLElement>('[data-timeline-item]').forEach((item) => {
        const dot = item.querySelector('[data-timeline-dot]');
        ScrollTrigger.create({
          trigger: item,
          start: 'top 65%',
          onEnter: () => item.classList.add('is-active'),
          onLeaveBack: () => item.classList.remove('is-active'),
        });
        if (dot) gsap.from(dot, { scale: 0, duration: 0.8, scrollTrigger: { trigger: item, start: 'top 70%', once: true } });
      });
    });
  }, root);

  html.classList.add('anim-ready');
  // Recalcular posiciones cuando cargan las fuentes e imágenes diferidas.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  return () => {
    lazySplit.disconnect();
    splits.forEach((s) => s.revert());
    ctx.revert();
  };
}

function formatCount(value: number, el: HTMLElement): string {
  const decimals = Number(el.dataset.decimals || 0);
  return value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
