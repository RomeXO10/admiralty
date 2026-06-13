# Admiralty

An Age of Sail fleet-command game in three.js. You are an admiral, not a
helmsman — see [`DESIGN.md`](DESIGN.md) for the vision and
[`ROADMAP.md`](ROADMAP.md) for the build order.

## Status — P1: Sailing physics

A ship that sails honestly under a true wind: it points poorly upwind, refuses
to make ground inside the no-go zone, gathers and loses way with momentum,
slips to leeward, and must tack (through the wind) or wear (around it) to work
to windward — missing stays into irons if it tries with too little way on. Still
a deterministic fixed-timestep sim, split from rendering.

What's in place:

- **`src/core/`** — the architectural backbone: a fixed-timestep `GameLoop` with
  a render/interpolation split, a seeded deterministic `Rng`, a small event bus,
  and math helpers. No three.js.
- **`src/sim/`** — pure, three.js-free game state. A deterministic wave field
  and wave-driven buoyancy (P0); on top of it the sailing model (P1): a true
  `Wind`, table-driven speed `polar`s per rig type, per-class constants
  (`shipClass`), and a `Ship` whose dynamics — drive, momentum, leeway,
  steerage-gated steering, tacking/wearing, and irons — follow
  [`docs/sailing-model.md`](docs/sailing-model.md). The `World` owns the wind
  and keeps previous + current poses so the renderer can interpolate.
- **`src/render/`** — three.js scene: a shader ocean that reproduces the *same*
  wave field the sim uses (so the hull sits on the water), sky + sun + lighting,
  a placeholder ship model, an orbit camera that follows the flagship, and a
  wind indicator.

### Demo controls

`npm run dev`, then: **A/D** steer · **W/S** make/reduce sail · **Q** tack ·
**E** wear · drag to orbit · scroll to zoom. The debug HUD reads out the wind,
heading, point of sail, and speed.

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
ship buoyancy/world interpolation, and the full sailing model — the speed
polars, true-wind angles, the no-go zone, momentum, leeway, steerage-gated
steering, tacking/wearing, missing stays into irons, and end-to-end
determinism. The render layer (three.js/WebGL) is verified through the demo
rather than unit tests.

## Architecture rule

The simulation (`core/`, `sim/`, and later `command/`, `perception/`, `ai/`) is
**deterministic and never imports three.js**. The render layer reads sim state
and interpolates; it never mutates the sim. This is what keeps fog of war, enemy
AI, and the after-action replay tractable in later phases.
