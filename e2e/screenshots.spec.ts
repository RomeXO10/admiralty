import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * PR screenshot run.
 *
 * Limited assertions — just enough to prove the WebGL demo actually booted and
 * drew something (a blank canvas would still "pass" a naive existence check, so
 * we sample pixels too). The deliverable is the screenshots in `e2e/screenshots/`,
 * which the PR workflow uploads as a downloadable artifact.
 */

const SHOT_DIR = fileURLToPath(new URL("./screenshots", import.meta.url));
// A fixed seed in the URL hash makes the deterministic duel reproducible run to
// run, so the captured frames are comparable across PRs.
const DUEL_URL = "/admiralty/#0";

/** Wait until the three.js canvas exists and has actually painted a frame. */
async function waitForRenderedCanvas(page: Page): Promise<void> {
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The canvas must have real dimensions...
  const box = await canvas.boundingBox();
  expect(box, "canvas should have a layout box").not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // ...a live WebGL context...
  const hasWebGL = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  });
  expect(hasWebGL, "canvas should have a WebGL context").toBe(true);

  // ...and it must not be a blank frame. A WebGL canvas clears its drawing buffer
  // after compositing, so reading it back in-page is unreliable — instead poll
  // Playwright's own (reliable) capture and check it carries real detail. A flat
  // single-colour frame compresses to a few KB; the rendered sea + ships is far
  // larger, so a generous byte-size floor distinguishes "drew something" from blank.
  await expect
    .poll(async () => (await page.screenshot()).byteLength, {
      message: "canvas should render a non-blank frame",
      timeout: 30_000,
    })
    .toBeGreaterThan(50_000);
}

/** Wait until the HUD has been populated with telemetry. */
async function waitForHud(page: Page): Promise<void> {
  // The HUD text is written on the first fps-sample tick (~400ms in).
  await expect(page.locator("#hud")).toContainText("ADMIRALTY", { timeout: 15_000 });
}

test.beforeAll(async () => {
  await mkdir(SHOT_DIR, { recursive: true });
});

test("captures the opening position", async ({ page }) => {
  await page.goto(DUEL_URL);
  await waitForRenderedCanvas(page);
  await waitForHud(page);

  await page.screenshot({ path: `${SHOT_DIR}/01-opening.png` });
});

test("captures the duel mid-combat", async ({ page }) => {
  await page.goto(DUEL_URL);
  await waitForRenderedCanvas(page);
  await waitForHud(page);

  // Let the deterministic sim run so the ships close, smoke blooms, and the HUD
  // fills with combat telemetry, then capture the action.
  await page.waitForTimeout(12_000);
  await expect(page.locator("#hud")).toContainText("COMBAT");

  await page.screenshot({ path: `${SHOT_DIR}/02-battle.png` });
});

test("captures the HUD telemetry panel", async ({ page }) => {
  await page.goto(DUEL_URL);
  await waitForRenderedCanvas(page);
  await waitForHud(page);

  // Pause (spacebar) so the telemetry panel is a clean, legible snapshot.
  await page.keyboard.press(" ");
  await expect(page.locator("#hud")).toContainText("PAUSED");

  await page.locator("#hud").screenshot({ path: `${SHOT_DIR}/03-hud.png` });
});
