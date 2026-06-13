/**
 * Per-class sailing constants — the tunable "data" the dynamics read.
 *
 * Keeping these out of the integration code is deliberate (see
 * `docs/sailing-model.md` §9): we tune the feel of a ship by editing tables and
 * numbers here, never by touching the tick math. All values are SI (m, s, rad).
 */
import { SQUARE_POLAR, FORE_AFT_POLAR, type PolarPoint } from "./polar";
import { BatterySide, type BatterySpec } from "./battery";
import { DEFAULT_DAMAGE, type DamageConfig } from "./damage";

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

  // --- Combat constants (P3) — the guns she carries and the hull's resilience. ---
  /** The batteries this class is built with (see `battery.ts`). */
  batteries: readonly BatterySpec[];
  /** Damage-model dynamics (crew complement, buoyancy, pumps, morale). */
  damage: DamageConfig;
  /** Crew/gunnery training quality (0.7 raw .. ~1.2 crack). */
  crewQuality: number;
}

/** A frigate's broadside: two beam batteries plus light bow and stern chasers. */
const FRIGATE_BATTERIES: readonly BatterySpec[] = [
  { side: BatterySide.Port, guns: 13, gunWeight: 18, baseReload: 22 },
  { side: BatterySide.Starboard, guns: 13, gunWeight: 18, baseReload: 22 },
  { side: BatterySide.BowChaser, guns: 1, gunWeight: 9, baseReload: 30 },
  { side: BatterySide.SternChaser, guns: 1, gunWeight: 9, baseReload: 30 },
];

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

  batteries: FRIGATE_BATTERIES,
  damage: { ...DEFAULT_DAMAGE, complement: 280 },
  crewQuality: 1,
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

  // A cutter is a light gun platform: a handful of small guns a side.
  batteries: [
    { side: BatterySide.Port, guns: 5, gunWeight: 6, baseReload: 18 },
    { side: BatterySide.Starboard, guns: 5, gunWeight: 6, baseReload: 18 },
  ],
  damage: { ...DEFAULT_DAMAGE, complement: 70, reserveBuoyancy: 60, pumpRate: 2.5 },
  crewQuality: 0.95,
};

/** A ship of the line — slow and unhandy, but a crushing weight of metal. */
export const SHIP_OF_THE_LINE: ShipClass = {
  ...FRIGATE_SQUARE,
  name: "Third-rate ship of the line",
  maxSpeed: 5.2,
  turnRate: 0.07,
  maneuverYawRate: 0.5,
  steerageSpeed: 1.3,

  halfLength: 7.5,
  halfBeam: 2.4,

  // Two full gun decks: 24s below, 18s above, modelled as one heavy battery a side.
  batteries: [
    { side: BatterySide.Port, guns: 37, gunWeight: 24, baseReload: 28 },
    { side: BatterySide.Starboard, guns: 37, gunWeight: 24, baseReload: 28 },
    { side: BatterySide.BowChaser, guns: 2, gunWeight: 12, baseReload: 34 },
    { side: BatterySide.SternChaser, guns: 2, gunWeight: 12, baseReload: 34 },
  ],
  damage: { ...DEFAULT_DAMAGE, complement: 640, reserveBuoyancy: 200, pumpRate: 7 },
  crewQuality: 1,
};
