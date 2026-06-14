/**
 * Guns, batteries, and bearing arcs (P3) — see `docs/gunnery-damage-model.md` §1.
 *
 * Age-of-sail guns have **fixed traverse**: you aim by pointing the hull. A
 * broadside battery only **bears** when the target sits in a window abeam; the
 * bow/stern chasers cover narrow fore-and-aft arcs, so most of a ship's
 * length-wise approach has no guns bearing at all — which is exactly what makes
 * raking deadly (§5). A battery reloads over time (faster with a full crew,
 * slower as casualties mount) and can have guns dismounted by enemy fire.
 *
 * Pure, three.js-free, deterministic. The geometry helpers take plain numbers so
 * they're trivially testable without a whole ship.
 */
import { wrapAngle } from "@core/math";

/** Which face of the ship a battery fires from. */
export enum BatterySide {
  Port = "Port",
  Starboard = "Starboard",
  BowChaser = "BowChaser",
  SternChaser = "SternChaser",
}

/** Shot type — chosen per battery; trades hull vs. rigging vs. crew (§4). */
export enum ShotType {
  /** Round: holes the hull, dismounts guns, floods below the waterline. */
  Round = "Round",
  /** Chain: tears rigging and brings down masts — a mobility kill. */
  Chain = "Chain",
  /** Grape: sweeps the crew, but only at close range. */
  Grape = "Grape",
}

/** Broadside (one volley then a long reload) vs. rolling (fire as guns come up). */
export enum FireMode {
  Broadside = "Broadside",
  Rolling = "Rolling",
}

/** Half-width (rad) of a broadside's bearing window about the beam (≈ ±35°). */
export const BEAM_ARC_HALF = (35 * Math.PI) / 180;
/** Half-width (rad) of a chaser's narrow fore/aft arc (≈ ±15°). */
export const CHASER_ARC_HALF = (15 * Math.PI) / 180;

/** The data that defines a battery on a ship class (before it takes any damage). */
export interface BatterySpec {
  readonly side: BatterySide;
  readonly guns: number;
  /** lb of shot — heavier hits harder but reloads slower and sits on lower decks. */
  readonly gunWeight: number;
  /** Seconds to reload at full crew. */
  readonly baseReload: number;
  /** Initial shot loaded (defaults to Round). */
  readonly shotType?: ShotType;
  /** Initial fire mode (defaults to Broadside). */
  readonly fireMode?: FireMode;
}

/**
 * Signed relative bearing (rad) of a world point from a hull: the shortest arc
 * from the bow to the point, **positive to starboard**. 0 is dead ahead, +π/2
 * the starboard beam, −π/2 the port beam, ±π dead astern. Matches the sim frame
 * (forward = (cos ψ, sin ψ), starboard = (−sin ψ, cos ψ)).
 */
export function relativeBearing(
  heading: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const fwd = dx * Math.cos(heading) + dz * Math.sin(heading);
  const stb = -dx * Math.sin(heading) + dz * Math.cos(heading);
  return Math.atan2(stb, fwd);
}

/** Does `side` bear on a target at signed `relBearing`? (See the arc constants.) */
export function bears(side: BatterySide, relBearing: number): boolean {
  switch (side) {
    case BatterySide.Starboard:
      return Math.abs(wrapAngle(relBearing - Math.PI / 2)) <= BEAM_ARC_HALF;
    case BatterySide.Port:
      return Math.abs(wrapAngle(relBearing + Math.PI / 2)) <= BEAM_ARC_HALF;
    case BatterySide.BowChaser:
      return Math.abs(relBearing) <= CHASER_ARC_HALF;
    case BatterySide.SternChaser:
      return Math.abs(wrapAngle(relBearing - Math.PI)) <= CHASER_ARC_HALF;
  }
}

/** A battery's mutable state: shot loaded, reload progress, guns lost. */
export class Battery {
  readonly side: BatterySide;
  readonly guns: number;
  readonly gunWeight: number;
  readonly baseReload: number;

  shotType: ShotType;
  fireMode: FireMode;

  /** Seconds of reloading still to run; ≤ 0 means loaded and ready. */
  reloadTimer = 0;
  /** Guns knocked out by enemy fire; reduces the volley. */
  dismounted = 0;

  constructor(spec: BatterySpec) {
    this.side = spec.side;
    this.guns = spec.guns;
    this.gunWeight = spec.gunWeight;
    this.baseReload = spec.baseReload;
    this.shotType = spec.shotType ?? ShotType.Round;
    this.fireMode = spec.fireMode ?? FireMode.Broadside;
  }

  /** Guns still able to fire. */
  get effectiveGuns(): number {
    return Math.max(0, this.guns - this.dismounted);
  }

  /** Loaded, manned, and ready to fire. */
  get ready(): boolean {
    return this.reloadTimer <= 0 && this.effectiveGuns > 0;
  }

  /**
   * Advance the reload. A short-handed crew loads slower, so time is scaled by
   * `crewFactor` (1 at full complement); it never fully stalls.
   */
  stepReload(dt: number, crewFactor: number): void {
    if (this.reloadTimer > 0) this.reloadTimer -= dt * crewFactor;
  }

  /** Fire: empty the guns and start the reload clock. */
  fire(): void {
    this.reloadTimer = this.baseReload;
  }

  /** Knock out `n` guns (capped at the battery size). */
  dismount(n: number): void {
    this.dismounted = Math.min(this.guns, this.dismounted + n);
  }
}
