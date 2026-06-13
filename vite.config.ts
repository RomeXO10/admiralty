/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@sim": fileURLToPath(new URL("./src/sim", import.meta.url)),
      "@render": fileURLToPath(new URL("./src/render", import.meta.url)),
    },
  },
  test: {
    // The deterministic sim (`core/`, `sim/`) is pure and needs no DOM. Render
    // (three.js/WebGL) is deliberately left out of unit tests — see the testing
    // principle in ROADMAP.md.
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/sim/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
