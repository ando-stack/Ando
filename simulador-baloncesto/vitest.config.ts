import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['engine/**/*.test.ts', 'tests/**/*.test.ts', 'ingest/**/*.test.ts'], testTimeout: 60000 } });
