/** Cambio de tema claro/oscuro con preferencia guardada en localStorage. */
import { THEME_KEY } from './config';
import type { Cleanup } from './motion';

export type Theme = 'dark' | 'light';

export const getTheme = (): Theme =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* almacenamiento no disponible: el tema se aplica solo en esta visita */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f1ec' : '#0b0b0c');
  window.dispatchEvent(new CustomEvent('aam:theme', { detail: theme }));
  syncToggles();
}

function syncToggles() {
  const theme = getTheme();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(theme === 'light'));
    btn.setAttribute('aria-label', theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
  });
}

export function initThemeToggle(root: ParentNode = document): Cleanup {
  syncToggles();
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');
  const onClick = () => setTheme(getTheme() === 'light' ? 'dark' : 'light');
  buttons.forEach((b) => b.addEventListener('click', onClick));
  return () => buttons.forEach((b) => b.removeEventListener('click', onClick));
}
