# Gunnery & Damage Model — detailed spec

How ships hurt each other (P3). Honest age-of-sail gunnery: broadsides you aim by
**pointing the ship**, roll-timed firing windows, localized damage, and outcomes
that are *struck/captured/sunk*, not just a health bar hitting zero.

> Lives in `sim/` — deterministic, seeded. Damage resolves **statistically per
> volley** in the sim; the render layer shows *representative* projectiles, smoke,
> and splashes (shown cannonballs need not equal the damage math).

---

## 1. Guns, batteries, arcs

```
Battery = {
  side        : Port | Starboard | BowChaser | SternChaser
  guns        : count
  gunWeight   : 32 | 24 | 18 | 12 | 9 | 6  (lb shot — heavier = lower deck)
  crewAssigned, baseReload, reloadTimer
  shotType    : Round | Chain | Grape
  fireMode    : Broadside | Rolling      // all-at-once vs. fire-as-reloaded
}
```

- Guns have **fixed traverse** — you aim the hull. A broadside battery **bears**
  when target bearing ∈ `[beam ± arcHalf]` (≈ ±35°). Chasers cover narrow
  fore/aft arcs only — most of a ship's length-wise approach has *no guns bearing*
  (this is what makes raking deadly, §5).
- Heavier guns (lower decks) hit harder but reload slower and are buried first
  when the ship heels to leeward (couples to `sailing-model.md` §8).

## 2. The firing window (roll timing)

Guns are aimed by elevation (quoins) + the ship's **roll phase**:

- **Up-roll** → shot flies high → rigging/masts (favors Chain; "French doctrine").
- **Down-roll** → shot into the hull (favors Round at close range; "British").

`rollTimingFactor ∈ [0,1]` rewards firing at the phase that matches the intended
aim point. "Fire as it bears" auto-picks a decent phase; a disciplined captain
(skill) hits the window more reliably. This makes *when* you fire matter, not just
*that* you fire.

## 3. Volley resolution (per battery, per fire event)

```
gunsFiring   = guns · (crewAssigned / crewNeeded)        // undermanned = fewer
hits = round( gunsFiring
            · baseHitRate
            · accuracy(range)            // 1 at point-blank → ~0 past max
            · crewQuality                // training; British > average
            · rollTimingFactor           // §2
            · aspectFactor(target)       // bigger broadside target = easier
            · shotType.rangeMod(range) )
```

- `accuracy(range)`: smooth falloff; point-blank ≈300 m high, near zero past max
  effective range. Time-of-flight lead is folded into `accuracy` vs. target speed
  for v1 (explicit ballistic arcs later).
- Resolve hits **statistically** with seeded RNG, then distribute across damage
  locations by shot type (§4). No per-ball tracking in the sim.

## 4. Shot types → localized damage

| Shot  | Best vs.   | Effect                                                     |
|-------|------------|------------------------------------------------------------|
| Round | Hull/guns  | holing (flooding if below waterline), dismount guns, crew  |
| Chain | Rigging    | mast integrity, sail efficiency, maneuver — a mobility kill |
| Grape | Crew       | sweeps crew at **close range only**; feeds morale collapse  |

```
DamageState = {
  hull        : integrity 0..1
  floodRate   : rising from below-waterline holes; pumps counter it
  masts       : { fore, main, mizzen } integrity     // 0 = mast falls
  rigging     : sail efficiency 0..1
  rudder      : steering integrity 0..1
  guns        : per-battery dismount count
  crew        : count → drives reload, sail-handling, boarding, morale
  morale      : 0..1
}
```

- **Flooding:** below-waterline hull hits add `floodRate`; pumps subtract; ship
  **sinks** when accumulated water exceeds reserve buoyancy → progressive list.
- **Dismasting:** mast at 0 collapses → big loss of sail area/speed (couples to
  `sailing-model.md` — reduces effective `maxSpeed`/`turnRate`) and can foul rigging.
- **Crew loss** slows reloads *and* sail handling (`sailTrimTime`/`tackTime` grow)
  and erodes morale.
- **Rudder** hit → impaired/lost steering (couples to steering authority).

## 5. Raking & aspect

Firing down a target's length (across **bow** or **stern**) sends shot through the
whole ship and the target **can't reply** (no broadside bears fore/aft):

```
rake bonus: damage × rakeMultiplier (e.g. ×2–3), crew & morale hit amplified
```

Crossing the enemy's bow/stern ("crossing the T", raking) is the prize maneuver —
the whole tactical incentive to win the wind and the angle.

## 6. Reload cycle & smoke

- `reloadTimer = baseReload / crewFactor`; **Broadside** = one big volley then a
  long reload; **Rolling** = steadier fire as guns come up, more continuous smoke.
- **Every fire event spawns a smoke cloud** to leeward → drifts with the wind and
  **blinds** the firer and its lee neighbors. This is the hard coupling to
  `fog-of-war-model.md` (a ship blazing away cannot see). Smoke clouds are owned by
  the perception layer (§ that doc), spawned here.

## 7. Boarding (light for v1)

When hulls close and grapple: resolve a **crew-strength × morale** contest over
time → **capture** or **repulse**. v1 keeps this coarse (a timed strength
comparison with morale modifiers); the mini-game depth is later.

## 8. Outcomes — the *result* the game shows

A ship leaves the fight by:
- **Striking colors** — morale collapse (casualties + dismasted + captain nerve,
  couples to `command-system.md` §4). Struck ships cease fire and can be **taken as
  a prize (captured)** — distinct from sunk.
- **Sinking** — flooding beats buoyancy.
- **Surrender via boarding** — captured by assault.
- **Fleeing/struck-and-abandoned** — disengages.

The after-action report (P6) tallies sunk / captured / struck / fled per side —
*results*, not just a kill count.

## 9. Determinism & tuning

- All resolution uses the shared seeded RNG; same seed + orders → identical battle.
- Data-expose: `baseHitRate, accuracy curve, shotType mods, reload times, damage
  weights, rakeMultiplier, floodRate, moraleThresholds`.

## v1 vs. later

- **v1:** batteries with bearing arcs; statistical volley resolution; round/chain/
  grape; localized damage (hull/flood/masts/rigging/rudder/guns/crew/morale);
  roll-timed firing window; raking bonus; reload + broadside/rolling modes; smoke
  spawning into perception; coarse boarding; strike/sink/capture outcomes.
- **Later:** explicit ballistic arcs & lead; double-shotting/heated shot; per-gun
  detail; powder-magazine explosions; fire (conflagration) spread; officer
  casualties; deep boarding mini-game.
