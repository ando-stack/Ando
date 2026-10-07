// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// URL pública del sitio (canónicas, sitemap, Open Graph).
// Netlify define la variable URL automáticamente en cada build.
// [COMPLETAR] Si usas un dominio propio, cámbialo aquí o define SITE_URL.
const site = process.env.SITE_URL || process.env.URL || 'https://aam-portfolio.netlify.app';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    react(),
    sitemap({ filter: (page) => !page.includes('/404') }),
  ],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  image: {
    responsiveStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Three.js (~130 kB comprimido) se carga de forma diferida solo en el inicio.
      chunkSizeWarningLimit: 600,
    },
  },
});
