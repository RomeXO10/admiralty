# Admiralty

An Age of Sail fleet-command game in three.js. You are an admiral, not a
helmsman — see [`DESIGN.md`](DESIGN.md) for the vision and
[`ROADMAP.md`](ROADMAP.md) for the build order.

## Status — P3: Cannons & damage

Two ships fight. On top of P2's command layer, P1's honest sailing, and P0's
shader sea, the guns now speak — and they're modelled the way an age-of-sail
gun deck actually worked. Broadsides have **fixed traverse**: a battery only
**bears** when the target lies abeam (±35°), so most of a length-wise approach
has no guns bearing, which is what makes the **rake** — crossing her bow or
stern to send shot down the whole ship while she can't reply — the prize
maneuver. Damage resolves **statistically per volley** (never per ball) and
lands on *places*: round shot holes the hull and floods her below the waterline,
chain brings down masts and cuts her speed, grape sweeps the crew at close
range. Reload paces the fire, the roll phase opens and closes the firing window,
and a battered captain's **morale** decides whether she keeps fighting. It ends
not at a health bar but with a ship **striking her colors** (taken as a prize)
or **sinking** — and a dismasted or short-handed hull sails worse the rest of
the fight. Still a deterministic fixed-timestep sim, split from rendering.

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
- **`src/sim/` gunnery & damage (P3)** — pure and three.js-free. A `battery`
  model (guns, shot types — round/chain/grape, bearing arcs, roll-paced reload,
  dismounting), a localized `damage` model (hull + flooding vs. pumps, per-mast
  integrity, rigging, rudder, crew, and morale, plus the derived multipliers the
  sailing model reads so a wounded ship sails slower), and the `GunnerySystem`
  that resolves a volley statistically — range/accuracy falloff, the roll-timing
  window, broadside aspect, the **rake** bonus across bow or stern — distributes
  the hits by shot type, spawns the smoke, and settles strike/sink outcomes.
  Follows [`docs/gunnery-damage-model.md`](docs/gunnery-damage-model.md).
- **`src/render/`** — three.js scene: a shader ocean that reproduces the *same*
  wave field the sim uses (so the hull sits on the water), sky + sun + lighting,
  a placeholder ship model whose sails thin out and come down as she's hit, an
  orbit camera framed on the two ships, drifting **cannon smoke** (spectacle
  only — it doesn't feed the sim yet), and a wind indicator.

### Demo controls

`npm run dev` opens a **duel**: your frigate and an enemy run side by side and
fight. You signal your ship (orders, not direct control) and lay her guns:

- **A/D** steer ±15° · **W/S** make/reduce sail · **Q** tack · **E** wear ·
  **H** hold station
- **1/2/3** load round / chain / grape · **F** fire a broadside · **C**
  cease/open fire
- **Space** tactical pause · **R** a fresh duel (new seed) · drag to orbit ·
  scroll to zoom

The HUD reads out both ships' condition — hull, masts, rigging, rudder, crew,
morale, flooding, and battery reload — the range, the live signals, and a combat
log of volleys (with **RAKE!** when you cross her ends) and outcomes. Maneuver to
bring your broadside to bear, or cross her stern to rake; the fight ends when one
ship strikes or sinks.

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
captain quality, and end-to-end determinism) — and the gunnery and damage layer:
the bearing arcs and reload cycle, the accuracy/range/roll-timing/aspect/rake
resolution, the localized damage model (holing, flooding vs. pumps, dismasting,
crew and morale), how that damage couples back to slow a wounded ship, and a
full duel — both its *in-between* progression (damage mounting volley by volley,
flooding rising before she founders, masts reported down mid-fight, the reload
cadence) and its strike/sink endgame, all deterministic from the seed. The
render layer (three.js/WebGL) is verified through the demo rather than unit tests.

## Architecture rule

The simulation (`core/`, `sim/`, and later `command/`, `perception/`, `ai/`) is
**deterministic and never imports three.js**. The render layer reads sim state
and interpolates; it never mutates the sim. This is what keeps fog of war, enemy
AI, and the after-action replay tractable in later phases.
