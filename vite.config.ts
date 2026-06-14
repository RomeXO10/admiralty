/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // GitHub Pages serves a project site from a subpath
  // (https://romexo10.github.io/admiralty/), so assets must resolve relative
  // to that base. Harmless for root-domain hosts.
  base: "/admiralty/",
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@sim": fileURLToPath(new URL("./src/sim", import.meta.url)),
      "@command": fileURLToPath(new URL("./src/command", import.meta.url)),
      "@fleet": fileURLToPath(new URL("./src/fleet", import.meta.url)),
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
      include: [
        "src/core/**/*.ts",
        "src/sim/**/*.ts",
        "src/command/**/*.ts",
        "src/fleet/**/*.ts",
      ],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
