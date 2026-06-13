# Admiralty

An Age of Sail fleet-command game in three.js. You are an admiral, not a
helmsman — see [`DESIGN.md`](DESIGN.md) for the vision and
[`ROADMAP.md`](ROADMAP.md) for the build order.

## Status — P0: Foundation

A ship floating on shader water with an orbit camera, driven by a deterministic
fixed-timestep simulation that is split from rendering.

What's in place:

- **`src/core/`** — the architectural backbone: a fixed-timestep `GameLoop` with
  a render/interpolation split, a seeded deterministic `Rng`, a small event bus,
  and math helpers. No three.js.
- **`src/sim/`** — pure, three.js-free game state: a deterministic sum-of-sines
  wave field and a `Ship` that heaves, pitches, and rolls by sampling it. The
  `World` keeps previous + current poses so the renderer can interpolate.
- **`src/render/`** — three.js scene: a shader ocean that reproduces the *same*
  wave field the sim uses (so the hull sits on the water), sky + sun + lighting,
  a placeholder ship model, and an orbit camera.

## Develop

```bash
npm install
npm run dev            # dev server at http://localhost:5173
npm run typecheck      # strict tsc, no emit
npm test               # run the unit tests (Vitest)
npm run test:watch     # tests in watch mode
npm run test:coverage  # tests + coverage report (core/ and sim/)
npm run build          # typecheck + production bundle
```

## Testing

Every feature ships with tests — see the **Test what you build** principle in
[`ROADMAP.md`](ROADMAP.md). The deterministic core (`src/core/`, `src/sim/`) is
pure and three.js-free, so it's covered by fast `node`-environment unit tests
co-located as `*.test.ts`: the seeded RNG and its reproducibility, the math and
angle-wrapping helpers, the fixed-timestep loop's accumulator, the wave field,
and ship buoyancy/world interpolation. The render layer (three.js/WebGL) is
verified through the demo rather than unit tests.

## Architecture rule

The simulation (`core/`, `sim/`, and later `command/`, `perception/`, `ai/`) is
**deterministic and never imports three.js**. The render layer reads sim state
and interpolates; it never mutates the sim. This is what keeps fog of war, enemy
AI, and the after-action replay tractable in later phases.
