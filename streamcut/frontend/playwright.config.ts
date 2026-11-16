import { defineConfig } from "@playwright/test";

// Requiere el backend (API + worker + monitor) y el frontend en marcha: ver README.
export default defineConfig({
  testDir: "./e2e",
  timeout: 10 * 60 * 1000,
  expect: { timeout: 30_000 },
  use: {
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
    baseURL: process.env.STREAMCUT_URL ?? "http://localhost:3000", viewport: { width: 1600, height: 1000 }, trace: "off" },
  workers: 1,
});
