import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { graficos: ['recharts'], supabase: ['@supabase/supabase-js'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  test: {
    include: ['engine/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
