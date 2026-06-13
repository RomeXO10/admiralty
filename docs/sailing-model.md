# Sailing Model — detailed spec

Concrete, buildable model for ship movement under sail. Honest but **parametric**:
table-driven polars now, CFD-flavored fidelity only where it earns its keep.
Feeds P1 (sailing physics) and is the physical substrate that P2 order *execution*
hands off to.

> Lives in `sim/` — **no three.js**. Deterministic, fixed-timestep, reproducible
> from seed + inputs.

---

## 1. Frame & units

- Sea is the XZ plane; `y` is up. Heading `ψ` is yaw about `y` (0 = +Z, CW).
- Internal units: meters, seconds, radians. **Knots only for display** (1 kn ≈
  0.514 m/s). Sim runs at fixed `dt` (target 1/60 s; physics is `dt`-independent).
- Wind is described by the direction it blows **from** (meteorological), speed in
  m/s. v1: one wind per battle, optional slow drift/gusts later.

## 2. Per-ship dynamic state

```
position   : vec2 (x, z)
heading    : ψ            // radians
velocity   : vec2         // world-space; decomposed into surge (fwd) + sway (side)
yawRate    : ω            // rad/s
sailSet    : enum { Furled, Reduced, Battle, Full }   // → trim fraction s
rudder     : δ ∈ [-1, 1]  // set by captain executing helm orders
inIrons    : bool         // stalled head-to-wind, no steerage
```

## 3. Per-class constants (tunable)

```
rig            : Square | ForeAft        // ships of the line = Square
maxSpeed       : hull speed (m/s) at ideal point of sail, full sail
mass           : for momentum / turn inertia
turnRate       : max yaw rate (rad/s) at full rudder & full steerage
steerageSpeed  : min surge speed for useful rudder authority (m/s)
leewayCoeff    : 0..~0.15  side-slip strength
sailTrimTime   : seconds to change one sailSet step (crew work)
tackTime       : seconds to swing bow through wind
nogoAngle      : no-go half-width (Square ≈ 60°, ForeAft ≈ 45°)
peakAngle      : TWA of best speed (Square ≈ 120°, ForeAft ≈ 100°)
polar[]        : 8 control points (see §5)
```

## 4. Points of sail (TWA = true wind angle, 0 = head to wind)

| TWA          | Name           | Square rig                         |
|--------------|----------------|------------------------------------|
| 0°           | In irons       | no drive, no steerage — avoid      |
| < nogoAngle  | No-go zone     | cannot make ground; must tack/wear |
| ~60–80°      | Close-hauled   | slow, max leeway, max heel         |
| 90°          | Beam reach     | fast                               |
| ~110–135°    | Broad reach    | **fastest** (peakAngle)            |
| 180°         | Running        | good but blanketed → ~0.8 of peak  |

Square riggers point poorly upwind (nogo ≈ 60°) and are fastest on a broad reach
— this asymmetry is the tactical heart of the wind game.

## 5. Speed polar (table-driven)

`polar(TWA) ∈ [0,1]` is the normalized drive factor. **Start with an 8-point
lookup per rig type, Catmull-Rom interpolated**, mirrored about 0–180°:

```
TWA :   0    30    60    80    100   130   160   180
square: 0.0  0.0   0.05  0.55  0.85  1.00  0.92  0.80
foreaft:0.0  0.0   0.45  0.80  1.00  0.95  0.80  0.65
```

- 0 below `nogoAngle` enforces the no-go zone.
- Per-class tables come later; rig-type defaults are fine for v1.
- This replaces any analytic formula — easy to read, tune, and per-ship author.

## 6. Tick (per fixed `dt`)

1. **TWA** = angle between wind-from direction and heading, in [0,180].
2. **Drive**: `targetSurge = maxSpeed · polar(TWA) · trim(sailSet) · windFactor`
   where `trim = {Furled:0, Reduced:0.45, Battle:0.7, Full:1.0}`.
3. **Surge** relaxes toward target with time constant `τ` (momentum/lag, stable):
   `surge += (targetSurge − surge) · (dt / τ)`  — accel slower than decel (`τ_up >
   τ_down`) so ships gather way gradually but luff/stall quickly.
4. **Leeway** (side-slip, downwind): `sway = maxSpeed · leewayCoeff · sideFactor(TWA)`,
   where `sideFactor` peaks close-hauled (~70°) and ≈0 when running. Add as a
   velocity component perpendicular to heading, pointing to leeward. This forces
   the player to *point higher than the desired course* — real navigation feel.
5. **Steering**: `rudderAuth = clamp(surge / steerageSpeed, 0, 1)`;
   `targetYaw = turnRate · rudderAuth · δ`; relax `yawRate` toward it. Below
   steerage speed the rudder goes dead.
6. **Compose velocity** from surge (along heading) + sway (leeward), integrate
   `position += velocity·dt`, `heading += yawRate·dt`.

## 7. Maneuvers

- **Tack** (bow through wind): captain sets the helm; over `tackTime` heading
  swings through the no-go zone. **Fail check**: if `surge < tackThreshold` when
  entering no-go, the ship **misses stays → in irons** (`inIrons=true`): drive→0,
  rudder dead, drifts to leeward until it falls off and rebuilds way. High risk in
  light air or with battle damage.
- **Wear** (stern through wind, the long way): never fails, but costs more time
  and ground to leeward. Square riggers historically preferred it — model it as
  the safe-but-expensive alternative the captain may choose on his own.
- **Sail set change**: takes `sailTrimTime` per step (Furled↔Reduced↔Battle↔Full);
  not instant. More sail = more drive **and** more heel.

## 8. Heel (v1: light) → gunnery hook

Heel angle ≈ `f(sideForce, sailSet)`. v1: mostly visual + a gunnery modifier —
the windward battery elevates, the leeward depresses; heavy heel can bury leeward
gun ports (can't fire). Full heel-driven roll/aim modeling deferred to P3 tuning.

## 9. Determinism & tuning

- All `clamp`/relax math is `dt`-stable; no stiff ODEs. Same seed + same orders →
  same track.
- Expose `τ_up, τ_down, leewayCoeff, nogoAngle, peakAngle, polar[]` as data so we
  tune by editing tables, not code.

## v1 vs. later

- **v1:** table polar by rig type; true-wind only; relaxation dynamics; leeway;
  steerage-gated rudder; tack-fail/in-irons; discrete sail sets; wear as captain
  option; light heel as a gun modifier.
- **Later:** apparent wind & boat-wind feedback; per-class polars; gusts/wind
  shifts; full heel→roll→aim coupling; current/tide; shallow-water & land effects.
