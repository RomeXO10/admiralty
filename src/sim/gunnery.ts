/**
 * Gunnery (P3) — how ships hurt each other. See `docs/gunnery-damage-model.md`.
 *
 * Damage resolves **statistically per volley**, never per ball (§3): a broadside
 * is one seeded-random math event, not a swarm of tracked projectiles (the
 * render layer may *show* a few cannonballs, but they don't feed this math). A
 * volley's bite is the product of the things that actually mattered on a gun
 * deck — how many guns bore and were manned, the range, the crew's quality, the
 * roll phase you caught, how broadside the target lay, and the shot you loaded —
 * and then it lands on **places** (`damage.ts`), not a health bar.
 *
 * The prize is the **rake** (§5): cross a ship's bow or stern and your shot runs
 * her whole length while she can't reply. That is the whole tactical incentive to
 * win the wind and the angle, so it carries a heavy multiplier.
 *
 * Pure, three.js-free, deterministic from the world's seed + the order of fire.
 */
import { clamp, wrapAngle } from "@core/math";
import type { World } from "./world";
import { ShipStatus, type Ship } from "./ship";
import {
  Battery,
  BatterySide,
  ShotType,
  bears,
  relativeBearing,
} from "./battery";
import type { MastId } from "./damage";

/** Every tunable the resolution reads (data-exposed per §9). All SI / fractions. */
export interface GunneryConfig {
  /** Base chance a bearing, manned gun scores in a volley before modifiers. */
  baseHitRate: number;
  /** Within this range (m) accuracy is at its peak. */
  pointBlankRange: number;
  /** Beyond this range (m) the guns are all but useless. */
  maxRange: number;
  /** Accuracy falloff shape between point-blank and max (higher = steeper). */
  accuracyExponent: number;
  /** Floor so a long shot is unlikely, not impossible. */
  accuracyFloor: number;

  /** Reference gun weight (lb); a battery scales damage by its weight over this. */
  referenceGunWeight: number;

  /** Half-angle (rad) of the bow/stern cone that counts as a rake. */
  rakeArcHalf: number;
  /** Damage multiplier when raking (§5). */
  rakeMultiplier: number;
  /** Extra morale shock a raking volley delivers. */
  rakeMoraleShock: number;

  /** Smallest broadside profile (end-on) … */
  aspectMin: number;
  /** … and largest (beam-on). */
  aspectMax: number;

  /** Grape is murderous within this range (m) … */
  grapeRange: number;
  /** … then falls off to nothing over this span (m). */
  grapeFalloff: number;

  /** Roll-timing: base factor, the gain on a well-caught phase, and its floor. */
  baseRollTiming: number;
  rollAimGain: number;
  minRollTiming: number;
  /** Heel (rad) used to normalize the roll phase into the timing factor. */
  heelReference: number;

  // --- Per-hit magnitudes at the reference gun weight ---
  hullPerHit: number;
  riggingPerHit: number;
  mastPerHit: number;
  rudderPerHit: number;
  crewPerRoundHit: number;
  crewPerGrapeHit: number;
  /** Expected guns dismounted per round-shot hit. */
  dismountPerRoundHit: number;
  /** Share of round hits that hole below the waterline (start flooding). */
  belowWaterlineFraction: number;
  /** Standing inflow (tonnes/s) added per below-waterline hit. */
  floodPerHole: number;
  /** Morale shock per grape hit. */
  grapeMoraleShock: number;
}

export const DEFAULT_GUNNERY: GunneryConfig = {
  baseHitRate: 0.45,
  pointBlankRange: 30,
  maxRange: 400,
  accuracyExponent: 1.6,
  accuracyFloor: 0.02,

  referenceGunWeight: 18,

  rakeArcHalf: (25 * Math.PI) / 180,
  rakeMultiplier: 2.5,
  rakeMoraleShock: 0.12,

  aspectMin: 0.5,
  aspectMax: 1.0,

  grapeRange: 80,
  grapeFalloff: 70,

  baseRollTiming: 0.85,
  rollAimGain: 0.15,
  minRollTiming: 0.65,
  heelReference: (8 * Math.PI) / 180,

  hullPerHit: 0.025,
  riggingPerHit: 0.05,
  mastPerHit: 0.08,
  rudderPerHit: 0.01,
  crewPerRoundHit: 4,
  crewPerGrapeHit: 9,
  dismountPerRoundHit: 0.15,
  belowWaterlineFraction: 0.4,
  floodPerHole: 0.5,
  grapeMoraleShock: 0.04,
};

/** What a single resolved volley did — feeds the combat log and the render smoke. */
export interface VolleyResult {
  readonly firerId: number;
  readonly targetId: number;
  readonly side: BatterySide;
  readonly shotType: ShotType;
  readonly range: number;
  readonly hits: number;
  readonly rake: boolean;
  readonly atTime: number;
  /** Where the powder smoke is born (to leeward of the firer) for the render layer. */
  readonly smokeX: number;
  readonly smokeZ: number;
}

/** A ship leaving — or nearly leaving — the fight; drives the after-action tally. */
export type CombatOutcome = "struck" | "sunk" | "dismasted";

export interface CombatReport {
  readonly shipId: number;
  readonly outcome: CombatOutcome;
  readonly detail: string;
  readonly atTime: number;
}

/** Fire discipline for a ship under the gunnery system. */
export enum FireControl {
  /** Fire as the guns bear and reload. */
  Free = "Free",
  /** Hold fire. */
  Hold = "Hold",
}

/** Per-ship combat disposition the gunnery system tracks. */
interface CombatProfile {
  crewQuality: number;
  nerve: number;
  target: number | null;
  fireControl: FireControl;
}

const DEFAULT_NERVE = 0.6;
/** Morale below which a captain may begin to think of striking. */
const STRIKE_THRESHOLD = 0.3;
/** How far nerve shifts that threshold (braver captains hold on longer). */
const NERVE_SPAN = 0.3;
/** Per-second strike hazard at the threshold, scaling up as morale collapses. */
const STRIKE_RATE = 0.8;
/** Mast factor below which a ship is reported effectively dismasted. */
const DISMASTED_FACTOR = 0.34;

// --- Pure resolution geometry (exported for tests) ---

/** Accuracy as a function of range: 1 at point-blank, falling to a floor by max. */
export function accuracy(range: number, cfg: GunneryConfig): number {
  if (range <= cfg.pointBlankRange) return 1;
  if (range >= cfg.maxRange) return cfg.accuracyFloor;
  const t = (range - cfg.pointBlankRange) / (cfg.maxRange - cfg.pointBlankRange);
  return cfg.accuracyFloor + (1 - cfg.accuracyFloor) * Math.pow(1 - t, cfg.accuracyExponent);
}

/** Shot-type range modifier — grape is close-only; round and chain carry. */
export function shotRangeMod(shot: ShotType, range: number, cfg: GunneryConfig): number {
  if (shot !== ShotType.Grape) return 1;
  if (range <= cfg.grapeRange) return 1;
  return clamp(1 - (range - cfg.grapeRange) / cfg.grapeFalloff, 0, 1);
}

/**
 * How broadside the target lies to the line of fire: 1 beam-on (the whole side
 * exposed), down to `aspectMin` end-on (a sliver). Note end-on is *also* where
 * raking happens — small target, but the shot runs her length.
 */
export function aspectFactor(firer: Ship, target: Ship, cfg: GunneryConfig): number {
  const losAngle = Math.atan2(target.pose.z - firer.pose.z, target.pose.x - firer.pose.x);
  const rel = wrapAngle(losAngle - target.heading);
  const beamness = Math.abs(Math.sin(rel));
  return cfg.aspectMin + (cfg.aspectMax - cfg.aspectMin) * beamness;
}

/** Is the firer off the target's bow or stern (a rake)? */
export function isRake(firer: Ship, target: Ship, cfg: GunneryConfig): boolean {
  const b = relativeBearing(target.heading, target.pose.x, target.pose.z, firer.pose.x, firer.pose.z);
  return Math.abs(b) <= cfg.rakeArcHalf || Math.abs(wrapAngle(b - Math.PI)) <= cfg.rakeArcHalf;
}

/**
 * The firing-window factor (§2): firing on the roll phase that matches your aim.
 * Round wants the down-roll (muzzles into the hull); chain wants the up-roll
 * (into the rigging); grape doesn't care. Starboard rises with positive roll.
 */
export function rollTimingFactor(
  roll: number,
  side: BatterySide,
  shot: ShotType,
  cfg: GunneryConfig,
): number {
  const sideSign = side === BatterySide.Starboard ? 1 : side === BatterySide.Port ? -1 : 0;
  const muzzleUp = clamp((sideSign * roll) / cfg.heelReference, -1, 1);
  const align = shot === ShotType.Round ? -muzzleUp : shot === ShotType.Chain ? muzzleUp : 0;
  return clamp(cfg.baseRollTiming + cfg.rollAimGain * align, cfg.minRollTiming, 1);
}

export class GunnerySystem {
  /** Gunnery clock (s), advanced in lockstep with the world by `tick`. */
  private time = 0;
  private readonly profiles = new Map<number, CombatProfile>();

  /** Every volley fired, in order — drives the render smoke and the log. */
  readonly volleys: VolleyResult[] = [];
  /** Ships striking, sinking, or losing their masts — the after-action trail. */
  readonly reports: CombatReport[] = [];

  constructor(
    private readonly world: World,
    readonly cfg: GunneryConfig = DEFAULT_GUNNERY,
  ) {}

  /** Bring a ship into the fight with a crew quality and a captain's nerve. */
  arm(
    shipId: number,
    opts: { crewQuality?: number; nerve?: number; target?: number; fireControl?: FireControl } = {},
  ): void {
    this.profiles.set(shipId, {
      crewQuality: opts.crewQuality ?? 1,
      nerve: opts.nerve ?? DEFAULT_NERVE,
      target: opts.target ?? null,
      fireControl: opts.fireControl ?? FireControl.Free,
    });
  }

  setTarget(shipId: number, targetId: number | null): void {
    const p = this.profiles.get(shipId);
    if (p) p.target = targetId;
  }

  setFireControl(shipId: number, fc: FireControl): void {
    const p = this.profiles.get(shipId);
    if (p) p.fireControl = fc;
  }

  /** Load a shot type into a ship's broadside batteries. */
  setShot(shipId: number, shot: ShotType): void {
    const ship = this.shipOf(shipId);
    if (!ship) return;
    for (const b of ship.batteries) {
      if (b.side === BatterySide.Port || b.side === BatterySide.Starboard) b.shotType = shot;
    }
  }

  /** Manually order every bearing, loaded battery to fire at the current target. */
  fireBroadside(shipId: number): void {
    const ship = this.shipOf(shipId);
    const profile = this.profiles.get(shipId);
    if (!ship || !profile || ship.status !== ShipStatus.Fighting) return;
    const target = profile.target === null ? undefined : this.shipOf(profile.target);
    if (!target || target.status === ShipStatus.Sunk) return;
    for (const battery of ship.batteries) {
      if (this.canFire(ship, battery, target)) this.fire(ship, battery, target, profile);
    }
  }

  /** Advance reloads, resolve free-firing, then settle strike/sink outcomes. */
  tick(dt: number): void {
    this.time += dt;

    for (const ship of this.world.ships) {
      const profile = this.profiles.get(ship.id);
      if (!profile || ship.status !== ShipStatus.Fighting) continue;

      const crewFactor = ship.damage.crewFactor;
      for (const battery of ship.batteries) battery.stepReload(dt, crewFactor);

      if (profile.fireControl === FireControl.Free && profile.target !== null) {
        const target = this.shipOf(profile.target);
        if (target && target.status !== ShipStatus.Sunk) {
          for (const battery of ship.batteries) {
            if (this.canFire(ship, battery, target)) this.fire(ship, battery, target, profile);
          }
        }
      }
    }

    // Outcomes after the fire is resolved, so a fatal volley registers this tick.
    for (const ship of this.world.ships) {
      if (ship.status !== ShipStatus.Fighting) continue;
      if (ship.damage.sinking) {
        ship.status = ShipStatus.Sunk;
        this.report(ship.id, "sunk", "flooded and went down");
        continue;
      }
      const profile = this.profiles.get(ship.id);
      if (profile && this.assessStrike(ship, profile, dt)) {
        ship.strike();
        profile.fireControl = FireControl.Hold;
        this.report(ship.id, "struck", "struck her colors");
      }
    }
  }

  /** A read-only combat snapshot of a ship for the HUD. */
  profileOf(shipId: number): Readonly<CombatProfile> | undefined {
    return this.profiles.get(shipId);
  }

  // --- Firing ---

  private canFire(firer: Ship, battery: Battery, target: Ship): boolean {
    if (!battery.ready) return false;
    if (battery.side !== BatterySide.Port && battery.side !== BatterySide.Starboard) return false;
    const range = this.range(firer, target);
    if (range > this.cfg.maxRange) return false;
    const relB = relativeBearing(
      firer.heading,
      firer.pose.x,
      firer.pose.z,
      target.pose.x,
      target.pose.z,
    );
    return bears(battery.side, relB);
  }

  private fire(firer: Ship, battery: Battery, target: Ship, profile: CombatProfile): void {
    const result = this.resolveVolley(firer, battery, target, profile);
    battery.fire();
    this.volleys.push(result);
  }

  /** Resolve one battery firing on a target: hits, then where they land (§3, §4). */
  private resolveVolley(
    firer: Ship,
    battery: Battery,
    target: Ship,
    profile: CombatProfile,
  ): VolleyResult {
    const cfg = this.cfg;
    const rng = this.world.rng;
    const range = this.range(firer, target);
    const shot = battery.shotType;
    const rake = isRake(firer, target, cfg);

    const gunsFiring = battery.effectiveGuns * firer.damage.crewRatio;
    const expected =
      gunsFiring *
      cfg.baseHitRate *
      accuracy(range, cfg) *
      profile.crewQuality *
      rollTimingFactor(firer.pose.roll, battery.side, shot, cfg) *
      aspectFactor(firer, target, cfg) *
      shotRangeMod(shot, range, cfg);

    const hits = stochasticRound(Math.max(0, expected), rng);
    if (hits > 0) this.applyDamage(target, battery, shot, hits, rake);

    // Smoke is born just to leeward of the firing side.
    const sideSign = battery.side === BatterySide.Starboard ? 1 : -1;
    const smokeX = firer.pose.x - Math.sin(firer.heading) * sideSign * firer.shipClass.halfBeam;
    const smokeZ = firer.pose.z + Math.cos(firer.heading) * sideSign * firer.shipClass.halfBeam;

    return {
      firerId: firer.id,
      targetId: target.id,
      side: battery.side,
      shotType: shot,
      range,
      hits,
      rake,
      atTime: this.time,
      smokeX,
      smokeZ,
    };
  }

  /** Distribute a volley's hits across the target's damage locations by shot type. */
  private applyDamage(
    target: Ship,
    battery: Battery,
    shot: ShotType,
    hits: number,
    rake: boolean,
  ): void {
    const cfg = this.cfg;
    const rng = this.world.rng;
    const weight = battery.gunWeight / cfg.referenceGunWeight;
    const m = (rake ? cfg.rakeMultiplier : 1) * weight;
    const d = target.damage;

    switch (shot) {
      case ShotType.Round: {
        const flood = hits * cfg.belowWaterlineFraction * cfg.floodPerHole * m;
        d.holeHull(hits * cfg.hullPerHit * m, flood);
        d.damageRudder(hits * cfg.rudderPerHit * m);
        d.loseCrew(Math.round(hits * cfg.crewPerRoundHit * m));
        const dismounts = stochasticRound(hits * cfg.dismountPerRoundHit * m, rng);
        if (dismounts > 0) this.pickBroadside(target, rng)?.dismount(dismounts);
        break;
      }
      case ShotType.Chain: {
        d.cutRigging(hits * cfg.riggingPerHit * m);
        d.damageMast(pickMast(rng), hits * cfg.mastPerHit * m);
        break;
      }
      case ShotType.Grape: {
        d.loseCrew(Math.round(hits * cfg.crewPerGrapeHit * m));
        d.shock(hits * cfg.grapeMoraleShock * m);
        break;
      }
    }

    if (rake) d.shock(cfg.rakeMoraleShock);

    // A ship that has lost the use of her masts is worth a note (once).
    if (
      d.mastFactor < DISMASTED_FACTOR &&
      target.status === ShipStatus.Fighting &&
      !this.reports.some((r) => r.shipId === target.id && r.outcome === "dismasted")
    ) {
      this.report(target.id, "dismasted", "lost her masts");
    }
  }

  /** Decide whether a battered captain strikes this tick (morale × nerve × seed). */
  private assessStrike(ship: Ship, profile: CombatProfile, dt: number): boolean {
    const threshold = clamp(STRIKE_THRESHOLD - (profile.nerve - 0.5) * NERVE_SPAN, 0.05, 0.6);
    const m = ship.damage.morale;
    if (m >= threshold) return false;
    const p = STRIKE_RATE * dt * (1 - m / threshold);
    return this.world.rng.next() < p;
  }

  // --- Lookups ---

  private report(shipId: number, outcome: CombatOutcome, detail: string): void {
    this.reports.push({ shipId, outcome, detail, atTime: this.time });
  }

  private pickBroadside(ship: Ship, rng: { next(): number }): Battery | undefined {
    const broadsides = ship.batteries.filter(
      (b) => b.side === BatterySide.Port || b.side === BatterySide.Starboard,
    );
    if (broadsides.length === 0) return undefined;
    return broadsides[Math.min(broadsides.length - 1, Math.floor(rng.next() * broadsides.length))];
  }

  private shipOf(id: number): Ship | undefined {
    return this.world.ships.find((s) => s.id === id);
  }

  private range(a: Ship, b: Ship): number {
    return Math.hypot(a.pose.x - b.pose.x, a.pose.z - b.pose.z);
  }
}

/** Round a fractional expectation to an integer, carrying the fraction as a coin flip. */
function stochasticRound(x: number, rng: { next(): number }): number {
  const floor = Math.floor(x);
  return floor + (rng.next() < x - floor ? 1 : 0);
}

/** Pick a mast, weighted toward the main (the biggest target). */
function pickMast(rng: { next(): number }): MastId {
  const r = rng.next();
  if (r < 0.3) return "fore";
  if (r < 0.8) return "main";
  return "mizzen";
}
