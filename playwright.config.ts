import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the PR screenshot run.
 *
 * The point of this suite is *not* deep behavioural coverage — the deterministic
 * sim is covered by the vitest unit tests (`npm test`). This run only smoke-tests
 * that the three.js/WebGL demo boots and renders, and — its real job — captures a
 * handful of specific screenshots that CI uploads as a downloadable artifact so a
 * reviewer can eyeball the render on every PR.
 *
 * It drives a `vite preview` of the production build, so what's screenshotted is
 * the same bundle GitHub Pages serves.
 */
const PORT = 4173;
const BASE_PATH = "/admiralty/"; // matches `base` in vite.config.ts

export default defineConfig({
  testDir: "./e2e",
  // The render is an animation; give the boot/draw a little room but keep it tight.
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: `http://localhost:${PORT}`,
    // WebGL needs a real-ish viewport; fix it so screenshots are reproducible.
    viewport: { width: 1280, height: 720 },
    // Cut motion blur between sim frames out of the captures where we can.
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          // Force a software GL stack so WebGL works on headless CI runners that
          // have no GPU. SwiftShader ships with Playwright's Chromium.
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],

  // Build once, then serve the built bundle the same way Pages does.
  webServer: {
    command: "npm run build && npm run preview -- --port " + PORT + " --strictPort",
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
