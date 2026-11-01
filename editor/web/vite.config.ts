import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const motor = process.env.ESTUDIO_MOTOR ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': motor, '/assets': motor },
  },
  build: { outDir: 'dist', assetsDir: 'app', chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
} as never);
