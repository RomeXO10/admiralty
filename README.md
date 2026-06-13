# Admiralty

An Age of Sail fleet-command game in three.js. You are an admiral, not a
helmsman — see [`DESIGN.md`](DESIGN.md) for the vision and
[`ROADMAP.md`](ROADMAP.md) for the build order.

## Status — P2: Command layer

You are the admiral, not the helmsman. You signal a consort sailing in company
and watch your order make its passage: a hoist goes up, is *seen* across the
water, *comprehended* by her captain, and only then *carried out* — the helm
holds its old course until the signal lands. Each order walks a six-stage
pipeline (hoist → en route → comprehend → execute), reception is gated by signal
range (the v1 stand-in for line of sight), the acknowledgement lags behind so
for a moment you've ordered into a void, a fresh order supersedes the previous
one in its domain, captains misread complex signals (telegraphed, never silent),
and orders the ship can't obey come back as reports. On top of P1's honest
sailing and P0's shader sea — still a deterministic fixed-timestep sim, split
from rendering.

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
  and keeps previous + current poses so the renderer can interpolate. Every ship
  now carries a stable `id`.
- **`src/command/`** — the command layer (P2), pure and three.js-free. An
  `order` vocabulary (steer/tack/wear/set-sail/hold), a `captain` profile
  (skill, lookout, and hooks for aggression/nerve/initiative), the `signal`
  latency model (reception, comprehension, misread chance + the *plausible
  wrong* order a misread produces), and the `CommandSystem` that runs each order
  through the six-stage pipeline, gates reception on range, tracks the
  acknowledgement as the admiral's *belief* separate from the act, applies
  executed orders to the sailing model, and emits stage events + outcome
  reports. Follows [`docs/command-system.md`](docs/command-system.md).
- **`src/render/`** — three.js scene: a shader ocean that reproduces the *same*
  wave field the sim uses (so the hull sits on the water), sky + sun + lighting,
  a placeholder ship model, an orbit camera framed on the flagship and her
  consort, and a wind indicator.

### Demo controls

`npm run dev`, then signal the **consort** (your orders, not direct control):
**A/D** steer ±15° · **W/S** make/reduce sail · **Q** tack · **E** wear ·
**H** hold station · drag to orbit · scroll to zoom. The debug HUD reads out the
wind and the consort's heading, point of sail, and speed, plus the live signals
(with their pipeline stage and acknowledgement) and a log of order outcomes —
watch each order lag before the consort obeys.

## Develop

```bash
npm install
npm run dev            # dev server at http://localhost:5173
npm run typecheck      # strict tsc, no emit
npm test               # run the unit tests (Vitest)
npm run test:watch     # tests in watch mode
npm run test:coverage  # tests + coverage report (core/, sim/, command/)
npm run build          # typecheck + production bundle
```

## Testing

Every feature ships with tests — see the **Test what you build** principle in
[`ROADMAP.md`](ROADMAP.md). The deterministic core (`src/core/`, `src/sim/`) is
pure and three.js-free, so it's covered by fast `node`-environment unit tests
co-located as `*.test.ts`: the seeded RNG and its reproducibility, the math and
angle-wrapping helpers, the fixed-timestep loop's accumulator, the wave field,
ship buoyancy/world interpolation, the full sailing model — the speed polars,
true-wind angles, the no-go zone, momentum, leeway, steerage-gated steering,
tacking/wearing, missing stays into irons — and the command layer: the latency
model and misread corruption, and the full order pipeline integrated with the
sim (signal delay before the helm moves, range-gated reception, the
acknowledgement lagging the act, supersede rules, misread/unexecutable reports,
captain quality, and end-to-end determinism). The render layer (three.js/WebGL)
is verified through the demo rather than unit tests.

## Architecture rule

The simulation (`core/`, `sim/`, and later `command/`, `perception/`, `ai/`) is
**deterministic and never imports three.js**. The render layer reads sim state
and interpolates; it never mutates the sim. This is what keeps fog of war, enemy
AI, and the after-action replay tractable in later phases.
