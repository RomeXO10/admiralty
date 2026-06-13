/**
 * Per-class sailing constants — the tunable "data" the dynamics read.
 *
 * Keeping these out of the integration code is deliberate (see
 * `docs/sailing-model.md` §9): we tune the feel of a ship by editing tables and
 * numbers here, never by touching the tick math. All values are SI (m, s, rad).
 */
import { SQUARE_POLAR, FORE_AFT_POLAR, type PolarPoint } from "./polar";

export type Rig = "square" | "foreAft";

/**
 * Discrete sail states the crew can set. Ordered by canvas aloft; the trim
 * fraction each maps to is in {@link SAIL_TRIM}.
 */
export enum SailSet {
  Furled = 0,
  Reduced = 1,
  Battle = 2,
  Full = 3,
}

/** Trim fraction (drive multiplier) for each sail state. */
export const SAIL_TRIM: Readonly<Record<SailSet, number>> = {
  [SailSet.Furled]: 0,
  [SailSet.Reduced]: 0.45,
  [SailSet.Battle]: 0.7,
  [SailSet.Full]: 1.0,
};

export interface ShipClass {
  name: string;
  rig: Rig;
  /** Drive lookup table; see `polar.ts`. */
  polar: readonly PolarPoint[];

  /** Hull speed (m/s) at the polar peak, full sail, reference wind. */
  maxSpeed: number;
  /** Max yaw rate (rad/s) at full rudder and full steerage way. */
  turnRate: number;
  /** Yaw rate (rad/s) of a committed tack/wear swing, carried by way + crew. */
  maneuverYawRate: number;
  /** Min surge (m/s) for useful rudder authority; below it the helm goes dead. */
  steerageSpeed: number;
  /** Side-slip strength, 0..~0.15. */
  leewayCoeff: number;

  /** Surge relaxation time constants (s): gather way slowly, lose it faster. */
  tauUp: number;
  tauDown: number;
  /** Yaw-rate relaxation time constant (s). */
  tauYaw: number;

  /** Seconds to traverse the full trim range (0→1) when making/reducing sail. */
  sailTrimTime: number;

  /** No-go half-width (rad): inside this the ship makes no ground to windward. */
  nogoAngle: number;
  /** Surge (m/s) below which swinging the bow through the wind misses stays. */
  tackThreshold: number;
  /** Yaw rate (rad/s) at which a stalled (in-irons) ship falls off the wind. */
  ironsFallOffRate: number;
  /** Visual heel (rad) at full side force — a gunnery hook later, cosmetic now. */
  maxHeel: number;

  /** Hull half-extents (m) for sampling waves and reading pose at a glance. */
  halfLength: number;
  halfBeam: number;
}

/** A square-rigged frigate — the default test/demo ship. */
export const FRIGATE_SQUARE: ShipClass = {
  name: "Frigate (square rig)",
  rig: "square",
  polar: SQUARE_POLAR,

  maxSpeed: 6.0,
  turnRate: 0.1,
  maneuverYawRate: 0.8,
  steerageSpeed: 1.0,
  leewayCoeff: 0.08,

  tauUp: 8,
  tauDown: 5,
  tauYaw: 1.5,

  sailTrimTime: 8,

  nogoAngle: Math.PI / 3, // 60°
  tackThreshold: 1.5,
  ironsFallOffRate: 0.05,
  maxHeel: (8 * Math.PI) / 180, // 8°

  halfLength: 4.5,
  halfBeam: 1.6,
};

/** A fore-and-aft cutter — points higher, handier, for variety/tests. */
export const CUTTER_FORE_AFT: ShipClass = {
  ...FRIGATE_SQUARE,
  name: "Cutter (fore-and-aft rig)",
  rig: "foreAft",
  polar: FORE_AFT_POLAR,
  maxSpeed: 5.0,
  turnRate: 0.14,
  nogoAngle: Math.PI / 4, // 45°
};
