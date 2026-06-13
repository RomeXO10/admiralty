# Admiralty — Design Document

> An Age of Sail fleet-command game in three.js. You are an admiral, not a
> helmsman: you give orders to captains and fight through imperfect information.

---

## 1. Core fantasy

You stand on the quarterdeck of your flagship. You cannot steer a single ship.
You command a fleet by issuing orders to your captains — and then you watch,
through a spyglass and a tactical plot, as the battle unfolds in ways you can
only partly see and only partly control.

The game is built on the gap between **intent and outcome**: the order you give,
the time it takes to reach a captain, the captain's skill and nerve in carrying
it out, and the wind and sea that have the final say.

## 2. Design pillars

### Pillar 1 — Command, not control
The interface is *orders*, never a steering wheel.

- Orders are issued to captains/squadrons, not to rudders and sails directly.
- Every order has **signal latency**: it is hoisted (signal flags), must be
  *seen* by the target ship, *acknowledged*, and *executed*. Distance, line of
  sight, smoke, and night all delay this.
- Captains have **autonomy and competence**: skill, morale, aggression, and
  initiative modify how fast and how faithfully an order is obeyed. A bold
  captain may engage early; a shaken one may haul off without orders.
- Standing orders & doctrine let you pre-author behavior ("hold the line",
  "general chase", "engage from leeward") so you aren't micromanaging.

### Pillar 2 — The fog of war
The map is a tool you trust at your peril.

- **Your** ships are known precisely (you receive their reports).
- **Enemy** ships are *estimates*: a last-known position that ages into a
  drifting uncertainty ellipse the longer you go without a fresh sighting.
- Knowledge is gated by **perception**: lookouts, line of sight, range, weather
  (fog, haze), darkness, and the smoke your own broadsides throw up.
- Contacts can be misidentified (a frigate mistaken for a ship of the line) and
  re-sighting collapses uncertainty back to a precise fix.

### Pillar 3 — Honest physics
Wind and ballistics, simulated — not hand-waved.

- **Sailing**: a true wind vector; points of sail; no sailing straight into the
  wind (the "no-go zone"); tacking (through the wind) vs. wearing (around it);
  speed as a function of point of sail and sail set; momentum and turning radius.
- **Gunnery**: cannons have range arcs and falloff; reload times per crew; the
  ship's roll opens and closes the firing window; broadsides vs. ranging shots;
  shot types — round (hull), chain (rigging/masts), grape (crew).
- **Damage**: localized — hull (flooding/sinking), masts & rigging (mobility),
  crew (rate of fire, boarding, control), rudder (steering). Striking the colors
  (surrender) and boarding are outcomes, not just sinking.

## 3. The game loop

1. **Brief** — scenario, fleet composition, the wind, victory conditions.
2. **Battle** — issue orders; watch in 3D and on the tactical plot; adapt to
   what you can (and can't) see. Real-time with **tactical pause** to assess and
   queue orders.
3. **After-action report** — losses, damage, captured/sunk/struck ships, and a
   **fog reveal**: the *true* track of the battle laid over what you believed,
   so you can see where your picture of the world was wrong.

## 4. Player-facing systems

### Camera & embodiment (framing-only)
- Fixed admiral's viewpoint anchored to the flagship's quarterdeck, with the
  ability to orbit/zoom for spectacle and a **spyglass** mode to inspect distant
  contacts (which also *generates* perception — looking is an action).
- No walkable deck in v1. Embodiment is conveyed through viewpoint, the spyglass,
  signal flags, and incoming reports — not character locomotion.

### The tactical plot
- Top-down chart: your ships exact; enemy contacts as markers with uncertainty
  ellipses and staleness; wind indicator; order overlays (planned headings,
  engagement lines).
- The primary surface for *giving* orders (select ship/squadron → issue order)
  and for *reading* the battle.

### Orders (initial vocabulary)
- Movement: steer to heading / to point, tack, wear, make/reduce sail, hold
  station, form line on flagship.
- Combat: engage target, fire as it bears / fire on my command / hold fire,
  choose shot type, close to / hold range, prepare to board, break off.
- Squadron: form line of battle, general chase, conform to flag movements.

## 5. Technical architecture

### Hard rule: simulation is separate from rendering
- **Fixed-timestep deterministic simulation** (e.g. 30–60 Hz) holds all game
  state (ship dynamics, gunnery, perception, AI). It must be reproducible from a
  seed + order log — this is what makes AI, fog of war, and the after-action
  replay tractable.
- **Render layer** (three.js) reads sim state and **interpolates** between ticks.
  Rendering never mutates simulation state.

### Layers
- `sim/` — physics (sailing, ballistics, damage), entity/component state, the
  deterministic tick. No three.js imports.
- `command/` — order queue, signal latency, captain AI executing orders.
- `perception/` — per-faction knowledge model; contacts, uncertainty, line of
  sight, weather/smoke occlusion.
- `ai/` — enemy fleet command (issues orders into the same command layer).
- `render/` — three.js scene: ocean shader, ship models, sails, particles
  (smoke/spray), camera/spyglass.
- `ui/` — tactical plot, order interface, briefing & after-action screens.
- `core/` — fixed-timestep loop, RNG (seeded), event bus, math utilities.

### Stack
- **TypeScript + Vite + three.js.** Strict types around the sim.
- Seeded PRNG for determinism. State kept in plain typed structures (data-oriented
  where it matters) so the sim is easy to step, snapshot, and replay.

## 6. Scope guardrails (v1)

In scope: single battles; a handful of ship classes; one player fleet vs. one AI
fleet; wind + open water (no land/shoals yet); core sailing & gunnery physics;
order latency + basic captain autonomy; fog of war with uncertainty; after-action
report.

Out of scope for v1 (later): campaign/meta-progression; walkable deck; boarding
mini-game depth; weather *systems* (just static-per-battle wind + visibility);
multiplayer; land masses & navigation hazards; historical scenario library.

## 7. Detailed mechanic specs

- [`docs/sailing-model.md`](docs/sailing-model.md) — wind, points of sail,
  table-driven polars, leeway, steering, tacking/wearing, in-irons.
- [`docs/command-system.md`](docs/command-system.md) — the six-stage order
  pipeline, signal latency, captain autonomy, fog-of-war coupling.
- [`docs/gunnery-damage-model.md`](docs/gunnery-damage-model.md) — batteries &
  arcs, roll-timed firing, statistical volleys, localized damage, raking,
  strike/sink/capture outcomes.
- [`docs/fog-of-war-model.md`](docs/fog-of-war-model.md) — contacts &
  uncertainty, detection, the smoke/visibility field, identity guessing, the
  after-action fog reveal.

## 8. Open questions (revisit as we build)

- How much captain autonomy is fun vs. frustrating? (Tune disobedience carefully.)
- Order UI on the 3D view, the plot, or both? Leaning: plot is primary.
- Fidelity of the sailing model — full polar diagrams per ship class, or a
  simplified parametric curve? Start simple, deepen if it earns its keep.
- How readable can uncertainty be made without a cluttered plot?
