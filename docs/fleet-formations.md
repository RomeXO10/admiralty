# Admiralty — Fleet formations & station-keeping (P4)

How a squadron moves as one. This is the deterministic foundation of P4: the
grouping, the geometry of a formation, and the controller that keeps a captain
in his place. The tactical plot and order-on-plot interface (the rest of P4)
read this layer; they do not reimplement it.

Lives in `src/fleet/` (`@fleet/*`). Pure of three.js, deterministic from the
world's state — same hard rule as `sim/` and `command/`.

## 1. The model

- A **squadron** (`Squadron`) is an ordered column of ships flying one flag:
  `memberIds` runs **van → rear** and *includes* the flagship. The flag is the
  reference the formation is measured from, and the ship the admiral actually
  signals (through the P2 command layer, like any single ship).
- A **formation** (`Formation`) is a rule mapping a member's column index to a
  **station** — a position and a course to hold — relative to the flag:
  - `LineAhead` — the line of battle: one column, bow to stern, lower indices
    *ahead*. Stations spread along the course.
  - `LineAbreast` — ships side by side, lower indices to *starboard*. Stations
    spread along the beam.
- The `interval` (m) is the spacing between neighbouring stations.

`stationFor(formation, ref, refIndex, index, interval)` is the whole geometry:
a signed `offset = (refIndex − index) · interval` placed along the course
(`forward = (cos ψ, sin ψ)`) for line ahead, or along the beam
(`starboard = (−sin ψ, cos ψ)`) for line abreast. Every station inherits the
reference course, so a formed line is parallel, not converging.

## 2. Conform to flag — station-keeping

Keeping station is **captain autonomy, not a signalled order.** Just as a captain
caught in irons works his own helm to fall off, a captain told to take station in
a formation steers continuously to hold his place — there is no fresh hoist every
tick. So `FleetSystem.tick()` sets each non-flag member's helm directly. The
sailing model still has the final say: a station dead to windward can't be held
any better than a captain could beat to it.

The controller is **pure pursuit** (`stationKeepingHeading`): a follower aims not
at her station but at a carrot pulled `lookahead` metres *downstream* of it along
the formation course.

- Far off station, the carrot is almost the station: she points at it and closes
  hard.
- As she settles, the carrot dominates and her course eases onto the formation
  course — the line ends up parallel and tight, not oscillating across it.
- A larger `lookahead` gives gentler, better-damped correction; the convergence
  time constant is roughly `lookahead / surge`.

Only the helm is touched, so a signalled **sail** order to a consort stands
alongside her station-keeping. A struck or sunk member keeps no station; a struck
or sunk flag leaves her squadron to hold their last helm rather than chase a
derelict.

## 3. Order of operations

`FleetSystem.tick()` runs **before** `world.tick(dt)` each step, so the helm a
ship integrates this step is the freshly computed one — mirroring how the command
layer ticks ahead of the world (see `docs/command-system.md`).

```
fleet.tick();   // conform-to-flag sets each consort's helm
command.tick(dt);
world.tick(dt); // ships integrate the helm they were just given
gun.tick(dt);
```

## 4. What's next in P4

- The 2D tactical plot (render/ui): own ships exact, wind indicator, order
  overlays — verified through the demo, not unit tests.
- Order interface on the plot: select a ship or squadron, issue helm/sail and
  squadron orders (form line, conform to flag) by pointer.
- Squadron-level orders routed through the command layer so re-forming the line
  carries its own signal latency.
