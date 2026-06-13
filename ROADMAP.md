# Admiralty — Roadmap

Build order for the Age of Sail fleet-command game. See `DESIGN.md` for the
full vision. Each phase ends in something **runnable and demonstrable** so we
always have a playable artifact and never a big-bang integration.

Decisions locked: **framing-only embodiment**, **real-time + tactical pause**,
**Age of Sail**, **TypeScript + Vite + three.js**, **fixed-timestep sim split
from rendering**.

---

## P0 — Foundation
**Goal:** a ship floating on water.
- Vite + TypeScript + three.js scaffold; dev server; strict tsconfig.
- Core fixed-timestep loop (`core/`) with seeded RNG and a render/interpolation split.
- Ocean: shader-based water plane; sky; basic lighting.
- One placeholder ship model; orbit camera.
- **Demo:** a boat bobbing on shader water, camera orbits.

## P1 — Sailing physics
**Goal:** a ship that sails honestly.
- True wind vector; points of sail; no-go zone; speed-vs-point-of-sail curve.
- Momentum, turning radius, sail set (make/reduce sail).
- Tacking vs. wearing as real maneuvers.
- Debug HUD: wind, heading, point of sail, speed.
- **Demo:** set a target heading; ship sails realistically, refuses to point
  upwind, must tack to make ground to windward.

## P2 — Command layer
**Goal:** you order, the ship obeys — eventually.
- Order types (movement subset) + order queue per ship.
- Signal latency: hoist → seen → acknowledged → executed; distance/LOS gating.
- Captain agent that executes orders with skill/initiative modifiers.
- **Demo:** issue heading/sail orders to one ship via a basic UI; watch the
  signal delay and the captain carry them out.

## P3 — Cannons & damage
**Goal:** two ships fight.
- Ballistics: range arcs, falloff, time of flight; ship roll firing window.
- Broadsides, reload per crew; shot types (round/chain/grape).
- Localized damage model: hull, masts/rigging, crew, rudder. Striking colors.
- Smoke/spray particle effects on fire.
- **Demo:** a scripted duel — two ships maneuver and exchange fire until one
  strikes or sinks.

## P4 — Fleet & tactical map
**Goal:** command a squadron from the plot.
- Multiple ships; squadron grouping; formations (line of battle, conform to flag).
- The 2D tactical plot: your ships exact, wind indicator, order overlays.
- Order interface lives primarily on the plot (select → order).
- **Demo:** maneuver a small fleet into line of battle and engage from the plot.

## P5 — Fog of war
**Goal:** fight through imperfect information.
- Per-faction perception model; contacts with last-known position.
- Uncertainty ellipses that grow with staleness; collapse on re-sighting.
- Line of sight, range, weather/visibility, own-broadside smoke occlusion.
- Spyglass as a perception action; possible contact misidentification.
- **Demo:** enemy ships show as aging estimates; scouting and looking resolve
  them; losing contact reintroduces uncertainty.

## P6 — Enemy AI & full battle loop
**Goal:** a complete battle, brief to result.
- Enemy fleet AI issuing orders through the same command layer.
- Briefing screen (fleets, wind, objective); victory/defeat conditions.
- After-action report with the **fog reveal** (true track vs. believed).
- **Demo:** play a full single battle end to end and read the result.

## P7 — Embodiment & polish
**Goal:** make it feel like the deck.
- Admiral viewpoint on the quarterdeck; signal-flag visuals; spyglass polish.
- Audio (wind, sea, gunfire, orders); UI pass; one or two crafted scenarios.
- Tuning pass on captain autonomy, latency, and plot readability.
- **Demo:** a presentable vertical slice of the full experience.

---

## Cross-cutting principles
- **Determinism first.** Sim reproducible from seed + order log; no three.js in
  `sim/`. Protect this from P0 — it pays off in P5/P6.
- **Always runnable.** Every phase produces a demo; avoid long integration gaps.
- **Start simple, deepen what earns it.** Parametric sailing/gunnery before full
  polar diagrams; add fidelity only where it adds fun.
- **Readability of uncertainty** is a first-class UI problem, not an afterthought.
