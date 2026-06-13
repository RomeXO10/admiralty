# Fog of War & Perception Model — detailed spec

What the admiral actually *knows* (P5). You know your own ships; the enemy is a set
of **estimates that age**. The tactical plot is built from this layer — a picture
you trust at your peril.

> Lives in `perception/`. Reads `sim/` truth + the visibility field, writes
> per-faction belief. The plot UI renders **only** from this belief, never from
> sim truth — that separation is what makes the after-action **fog reveal** possible.

---

## 1. The Contact (unit of belief)

```
Contact = {
  trackId, faction,
  entityId?       : resolved truth link, only while firm (else null = a guess)
  lastPos, lastSeenTick,
  estVel          : smoothed track velocity at last sighting
  sigma           : positional uncertainty radius (grows when unseen)
  identityGuess   : Unknown | Frigate | ShipOfLine | Merchant ...
  idConfidence    : 0..1
  status          : Firm | Stale | Lost
}
```

- **Firm** (perceived now): `lastPos≈truth`, `sigma→sigmaMin`, `idConfidence`
  rising with observation time.
- **Stale** (lost sight): position **dead-reckoned** `lastPos + estVel·Δt`; an
  **uncertainty ellipse grows**: `sigma = sigmaMin + plausibleSpeed · Δt · spread`.
- **Lost** (Δt large): collapses to a vague "last seen" region / drops toward
  off-plot. Re-sighting **snaps it back to Firm** and collapses `sigma`.

## 2. Detection — who can see what

Target `T` is detected by observer `O` when **both**:

```
1. dist(O,T) ≤ detectionRange(O,T)
2. line-of-sight path O→T is not blocked beyond a threshold
```

```
detectionRange(O,T) = baseRange
  · lookoutQuality(O)        // crew quality; a sharp lookout sees further
  · visibilityFactor         // battle-wide weather (clear / haze / fog)
  · sizeFactor(T)            // sail area — you see TOPSAILS before hull
  · nightFactor              // night ≪ day
  − smokeAttenuation(path)   // §4
```

- **Tops'ls over the horizon:** large `sizeFactor` for sails means you sight a
  ship-of-the-line's topsails as a faint contact long before identity resolves —
  "sails on the horizon!" then slowly "...a two-decker, maybe a 74."
- **LOS blockers:** smoke clouds (§4), fog/haze (lowers `visibilityFactor` and the
  hard horizon), night, hull-down at distance. Land/islands: later.

## 3. Fleet knowledge fusion

The admiral's plot = the **union of all friendly ships' contacts**. A frigate
scouting ahead literally extends your sight.

- **v1:** friendly sightings fuse to the plot with a short fixed **report delay**
  (the picture isn't instant, but you trust the fleet net).
- **Later:** reports travel the **signal graph** from `command-system.md` §5 — a
  scout out of signal range *sees them but can't tell you yet*. That tension is
  great but reserved so v1 doesn't drown in coupling.

Contacts from multiple observers are fused by proximity into one track (nearest
firm sighting wins position & identity).

## 4. The visibility field & smoke

```
VisibilityField = baseVisibility(weather)  +  dynamic SmokeClouds[]
SmokeCloud = { pos, radius, density, vel(=leeward wind), decay }
```

- **Smoke clouds are spawned by gunnery** (`gunnery-damage-model.md` §6), drift to
  **leeward** with the wind, expand, and **decay**. A LOS ray crossing smoke
  accumulates `smokeAttenuation`; enough → the path is blocked.
- Consequence: a ship firing broadsides **blinds itself and its lee neighbors** —
  the line of battle disappears into its own powder smoke. The wind decides who
  stays blind and who clears. This is a first-class tactical element, not flavor.

## 5. Identity & misidentification

`idConfidence` rises with closer range, longer observation, better visibility. At
range/in haze a contact's class is a **guess that can be wrong** (a 74 mistaken for
a frigate). The plot shows the guess **with its confidence** so a surprise reads as
"I misjudged her" — telegraphed, consistent with the command-system tuning ethos.

## 6. UI — uncertainty is a first-class design problem

| Status | Plot representation                                                   |
|--------|----------------------------------------------------------------------|
| Firm   | solid marker, true heading, class + high confidence                  |
| Stale  | fading marker drifting along DR, **growing uncertainty ellipse**, staleness clock |
| Lost   | vague "last seen here" region / ghost                                |
| ID?    | silhouette + confidence (`?`, or class with a confidence ring)       |

Anti-clutter rules (so the plot stays readable): cap displayed ellipse size, merge
overlapping unknown regions, fade by staleness, let the player toggle detail.

## 7. The after-action fog reveal (feeds P6)

Because belief is recorded separately from truth, the report can replay the
**true entity tracks** overlaid on the **Contact history** (what you believed) —
showing exactly where and when your picture of the battle was wrong. The single
most satisfying payoff of the whole fog system.

## 8. Couplings (summary)

- **← gunnery:** spawns smoke clouds into the visibility field.
- **↔ command-system:** the *same* LOS/visibility gates order reception (a captain
  who can't see the flag) and, later, scout reporting (signal graph).
- **→ UI/plot:** the plot renders only from this layer.
- **→ after-action:** belief-vs-truth overlay.

## 9. Determinism

Detection checks and any fusion jitter use the shared seeded RNG. Same seed +
orders → identical knowledge timeline → reproducible plot and reveal.

## v1 vs. later

- **v1:** Firm/Stale/Lost contacts with growing uncertainty ellipses & DR;
  detection by range·lookout·visibility·size·night; LOS blocked by smoke/fog/night;
  fleet fusion with short report delay; identity guessing with confidence; smoke
  clouds drifting on the wind; the plot UI; the fog-reveal hook.
- **Later:** signal-graph scout reporting; land/horizon hull-down occlusion;
  weather *systems* (moving fog banks, squalls); false contacts / deception;
  lookout fatigue; night signaling (lanterns).
