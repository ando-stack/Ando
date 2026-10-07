import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export default defineConfig(({command}) => ({
  base: command === 'build' ? '/app/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/files': backend,
      '/assets': backend,
      '/import-files': backend,
    },
  },
}));
