# Command & Signal-Latency System — detailed spec

The mechanical heart of Pillar 1: **you order, captains obey — eventually, and
imperfectly.** Feeds P2 (command layer) and couples tightly to P5 (fog of war),
since *knowing whether your order was even received* is itself imperfect
information.

> Order pipeline + captain AI live in `command/`. Execution hands off to
> `sim/` (sailing/gunnery). Reception/acknowledge gating queries `perception/`.

---

## 1. The order pipeline (six stages)

```
COMPOSE → HOIST → RECEIVE → ACKNOWLEDGE → COMPREHEND → EXECUTE
 (admiral) (flag) (target   (flagship    (captain     (crew +
            sees   sees it)   learns it)   decides)     physics)
```

| Stage        | Who      | Delay source                                        |
|--------------|----------|-----------------------------------------------------|
| Compose      | Admiral  | UI only; free, allowed during tactical pause        |
| Hoist        | Flagship | fixed `tHoist` (bend on + raise flags)              |
| Receive      | Target   | needs LOS to flagship/relay; range + lookout + visibility |
| Acknowledge  | Flagship | symmetric round-trip → updates *admiral's belief*   |
| Comprehend   | Captain  | skill-based; misread chance for complex orders      |
| Execute      | Crew     | order-specific physical time (tack, trim, run out)  |

Crucially, **EXECUTE consumes real time** and is performed by the sailing/gunnery
models — a "tack" order doesn't teleport the heading, it requests `tackTime` of
maneuver from the sailing model (see `sailing-model.md` §7).

## 2. Latency model (concrete)

```
tHoist     = const (~5 s sim)
tReceive   = expected wait until target's lookout reads the flags:
             baseLook / lookoutQuality  +  rangePenalty(distance)
             — and ONLY once LOS holds (visibility, smoke, night gate it)
tAck       = symmetric to tReceive (back to flagship)   // affects belief, not act
tComprehend= baseComprehend / captain.skill
             + misreadChance(order.complexity, range, visibility)
tExecute   = handed to sim (maneuver/gunnery duration)
```

- **LOS gating:** if the target can't see the flagship (out of range, fog, smoke,
  hull-down, night), the order simply **isn't received**. It waits, or routes via
  a **repeating frigate** (relay node) — see §5.
- **Misread:** on failure the captain executes a *plausible wrong* order (e.g.
  engages the wrong target, tacks instead of wears) and the player only finds out
  by watching — telegraphed, never silent corruption of state.

## 3. Order vocabulary (formal)

```
Order = {
  id, issuedTick, recipient,     // ship or squadron
  type, params,
  complexity,                    // drives misread chance & comprehend time
}
```

- **Movement:** SteerToHeading, SteerToPoint, Tack, Wear, SetSail(level),
  HoldStation, FormLineOnFlag.
- **Combat:** EngageTarget(id), FireAsItBears | FireOnCommand | HoldFire,
  ShotType(round|chain|grape), CloseToRange(r) | HoldRange(r), PrepareToBoard,
  BreakOff.
- **Squadron:** FormLineOfBattle, GeneralChase, ConformToFlag.
- **Standing orders / doctrine:** persistent defaults a captain falls back on when
  no fresh order applies (e.g. `EngageFromLeeward`, `HoldTheLine`, `Conserve`).

New orders **supersede** queued ones for the same domain (a new helm order cancels
the old). Un-executable orders (e.g. Tack while in irons) return a **report**
rather than silently failing — feeds the after-action log and the admiral's UI.

## 4. Captain autonomy

Each captain has a **visible** profile so deviations read as *character*, not
betrayal (see tuning principle below):

```
CaptainProfile = {
  skill,        // execution speed + comprehension accuracy
  aggression,   // tendency to engage/close on own initiative
  nerve,        // resistance to hauling off / striking under damage
  initiative,   // acts on doctrine in absence of orders
}
```

Initiative/deviation cases (all telegraphed):
- **Bold engage:** high-aggression captain closes/engages a target before ordered
  ("of course Hardy bore down — he always does").
- **Break under fire:** low-nerve captain with heavy hull/crew damage may haul off
  or **strike his colors** without orders.
- **Doctrine fallback:** with no applicable order, captain follows standing orders
  (general chase, hold the line, engage from leeward).

> **Tuning principle (load-bearing):** autonomy must feel like commanding *people*,
> not fighting your own UI. Tendencies are shown on a captain roster; every
> deviation is foreshadowed by trait + situation and explainable after the fact.
> Target the feeling "I should have given clearer orders," never "the game cheated."

## 5. Signal graph & repeating frigates

Reception is a small graph problem: flagship → (LOS, range, visibility) → targets.
A **repeating frigate** is a relay node that re-hoists the flag, extending range
and routing around LOS blocks (smoke, the line itself). v1 may ship without relays
but the model is built as a graph so they drop in cleanly at P4/P5.

## 6. Coupling to fog of war (P5)

The **ACKNOWLEDGE** stage is the player's only signal that an order landed. Until
the ack round-trips, the admiral **does not know** if the captain saw the flag —
an order may be sailing into a void. This is deliberate tension and is rendered as
order state on the plot: `Hoisted → Seen? → Acknowledged → Executing`.

## 7. Data structures

```
OrderQueue(perShip)        : domain-keyed (helm / sail / gunnery), supersede rules
SignalEvent                : {orderId, stage, atTick}  // drives UI + after-action
CaptainProfile             : as §4
Doctrine / StandingOrders  : persistent per ship/squadron
OrderReport                : success | misread | unexecutable | refused(nerve)
```

## 8. Edge cases

- Recipient struck/sunk before EXECUTE → order voided, reported.
- Conflicting orders → newest wins per domain; cross-domain coexist.
- Order issued during tactical pause → enters pipeline on unpause at HOIST.
- Squadron order → fans out to members, each runs its own pipeline (so the line
  doesn't turn as one rigid body — captains receive/comprehend at their own pace).

## v1 vs. later

- **v1:** full six-stage pipeline; LOS/range/visibility-gated reception; misread
  chance; the four-attribute captain profile with bold-engage / break-under-fire /
  doctrine-fallback; supersede rules; order state on the plot.
- **Later:** repeating-frigate relays; richer doctrine library; signal-book
  ambiguity (limited flag vocabulary forcing terse, misreadable orders); captain
  relationships/reputation; fatigue.
