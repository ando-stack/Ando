import { expect, test } from "@playwright/test";

const FIXTURE = process.env.STREAMCUT_FIXTURE ?? "/tmp/streamcut-fixtures/highlight.mp4";
const EMAIL = "e2e@example.com";
const PASSWORD = "contraseña-e2e-segura";
const SHOTS = process.env.STREAMCUT_SHOTS ?? "test-results";

test.describe.configure({ mode: "serial" });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  const setup = await page.getByRole("heading", { name: "Configura tu estudio" }).isVisible();
  if (setup) await page.getByLabel("Nombre").fill("Prueba E2E");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: setup ? "Crear cuenta" : "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Monitor de directos" })).toBeVisible();
}

test.beforeEach(async ({ page }) => login(page));

test("la sesión protege las rutas privadas", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/library");
  await expect(p).toHaveURL(/\/login/);
  await ctx.close();
});


test("importar vídeo → clips automáticos con subtítulos → biblioteca → editor", async ({ page }) => {
  await page.goto("/import");
  await page.locator('input[type="file"][multiple]').setInputFiles(FIXTURE);
  await expect(page.getByText(/Subido · procesando|ya existe en la biblioteca/)).toBeVisible({ timeout: 60_000 });
  // Espera a que la ingesta y el análisis terminen y haya clips
  await expect(page.getByRole("link", { name: /\d+ clips/ }).first()).toBeVisible({ timeout: 8 * 60_000 });
  await page.screenshot({ path: `${SHOTS}/import.png` });

  await page.goto("/library?sort=score");
  const card = page.locator(".card").filter({ has: page.getByTitle("Descargar MP4") }).first();
  await expect(card).toBeVisible({ timeout: 5 * 60_000 });
  await page.screenshot({ path: `${SHOTS}/library.png` });

  // Búsqueda por texto hablado
  await page.getByLabel("Buscar").fill("insane");
  await expect(page.getByText(/\d+ clips/)).toBeVisible();

  await page.goto("/library?sort=score");
  await page.locator(".card").filter({ has: page.getByTitle("Editar") }).first().getByTitle("Editar").click();
  await expect(page.getByText("edición no destructiva", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "1:1 Cuadrado", exact: true }).click();
  await expect(page.getByText(/Guardado · \d+ operaciones/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/editor.png` });
  await page.getByRole("button", { name: "Deshacer" }).click();
  await page.getByRole("button", { name: "Rehacer" }).click();
  await page.getByRole("button", { name: "Guardar y exportar" }).click();
  await page.getByRole("button", { name: /Versiones/ }).click();
  await expect(page.getByText("Versión 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Lista").first()).toBeVisible({ timeout: 5 * 60_000 });
});

test("monitor de directos: conectar canal y ver capacidades reales", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Enlace del canal").fill("https://www.twitch.tv/streamcut_demo_channel");
  await page.getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByText("AI LIVE DETECTION")).toBeVisible();
  await expect(page.getByTitle(/Reproductor oficial/)).toBeVisible();
  await expect(page.getByText("Capacidades activas de este canal")).toBeVisible();
  await expect(page.getByText("Sin acceso al audio/vídeo", { exact: false })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/monitor.png` });
});

test("dashboard y estadísticas con datos reales", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Clips creados").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dashboard.png` });
  for (const path of ["/stats", "/templates", "/automations", "/settings", "/channels", "/clips"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
  }
});
