/**
 * Localized damage model (P3) — see `docs/gunnery-damage-model.md` §4.
 *
 * A ship is not a single health bar. Shot lands on **places**: the hull (holing,
 * and flooding when it's below the waterline), the masts (which fall and cost
 * sail area), the rigging (sail efficiency), the rudder (steering), the guns
 * (dismounted per battery — that count lives on the {@link Battery}), and the
 * crew (which works the guns and the sails and, as it bleeds, the morale that
 * decides whether she keeps fighting).
 *
 * This module owns a ship's *condition* and the dynamics that follow from it:
 * flooding vs. pumps, and the derived multipliers the sailing model reads so a
 * dismasted or short-handed ship sails worse. The *incoming* magnitudes (how
 * much a round hit holes the hull) belong to the gunnery layer that knows the
 * shot type and gun weight; this module just exposes clamped mutators it calls.
 *
 * Pure, three.js-free, deterministic. No RNG here — flooding and the derived
 * factors are exact functions of the accumulated hits.
 */
import { clamp } from "@core/math";

export type MastId = "fore" | "main" | "mizzen";

/** Relative contribution of each mast to drive and balance (sums to 1). */
const MAST_WEIGHT: Readonly<Record<MastId, number>> = {
  fore: 0.25,
  main: 0.5,
  mizzen: 0.25,
};

/** The dynamics constants for a hull's condition — per-class, data-exposed. */
export interface DamageConfig {
  /** Crew the ship is fully manned with; the denominator for `crewRatio`. */
  complement: number;
  /** Water (abstract tonnes) she can take on before buoyancy is lost and she sinks. */
  reserveBuoyancy: number;
  /** Water the pumps clear per second at full crew; scales down when short-handed. */
  pumpRate: number;
  /** Morale lost per full-complement fraction of crew killed (the casualty shock). */
  moralePerCrewFraction: number;
  /** Morale shock the instant a mast goes by the board. */
  mastFallShock: number;
  /** Reload/handling never drops below this even with a skeleton crew. */
  minCrewFactor: number;
}

/** Sensible defaults; a class may override any field. */
export const DEFAULT_DAMAGE: Omit<DamageConfig, "complement"> = {
  reserveBuoyancy: 100,
  pumpRate: 4,
  moralePerCrewFraction: 1.6,
  mastFallShock: 0.18,
  minCrewFactor: 0.25,
};

export class DamageState {
  /** Hull integrity 0..1; 1 is sound. Holing drops it. */
  hull = 1;
  /** Sail efficiency 0..1 from cut rigging (chain shot). */
  rigging = 1;
  /** Steering integrity 0..1; a shot-away rudder loses authority. */
  rudder = 1;
  /** Per-mast integrity; 0 means the mast is down. */
  readonly masts: Record<MastId, number> = { fore: 1, main: 1, mizzen: 1 };

  /** Standing inflow from below-waterline holes (tonnes/s before pumps). */
  floodRate = 0;
  /** Water accumulated in the hold; she sinks when it reaches reserve buoyancy. */
  water = 0;

  /** Live crew count. Drives reload, sail handling, boarding, and morale. */
  crew: number;
  /** Will to fight 0..1; collapse leads the captain to strike (handled in gunnery). */
  morale = 1;

  constructor(readonly cfg: DamageConfig) {
    this.crew = cfg.complement;
  }

  // --- Mutators (clamped). Called by the gunnery layer when shot lands. ---

  /**
   * Hole the hull. `floodRateAdd` is the standing inflow from the portion that
   * struck below the waterline — it persists until she's pumped out or sinks.
   */
  holeHull(amount: number, floodRateAdd = 0): void {
    this.hull = clamp(this.hull - amount, 0, 1);
    if (floodRateAdd > 0) this.floodRate += floodRateAdd;
  }

  /** Damage a named mast; crossing to zero drops it and shocks morale. */
  damageMast(which: MastId, amount: number): void {
    const before = this.masts[which];
    const after = clamp(before - amount, 0, 1);
    this.masts[which] = after;
    if (before > 0 && after === 0) this.shock(this.cfg.mastFallShock);
  }

  /** Cut rigging — directly erodes sail efficiency. */
  cutRigging(amount: number): void {
    this.rigging = clamp(this.rigging - amount, 0, 1);
  }

  /** Damage the rudder / steering gear. */
  damageRudder(amount: number): void {
    this.rudder = clamp(this.rudder - amount, 0, 1);
  }

  /** Kill crew; the casualty shock erodes morale in proportion to the loss. */
  loseCrew(n: number): void {
    const before = this.crew;
    this.crew = Math.max(0, this.crew - n);
    const fracLost = (before - this.crew) / this.cfg.complement;
    this.morale = clamp(this.morale - fracLost * this.cfg.moralePerCrewFraction, 0, 1);
  }

  /** Direct morale shock (grape sweeping the deck, a mast going, a raking volley). */
  shock(amount: number): void {
    this.morale = clamp(this.morale - amount, 0, 1);
  }

  // --- Per-tick dynamics ---

  /** Advance flooding: net of inflow and pumps, never below dry. Deterministic. */
  step(dt: number): void {
    const net = this.floodRate - this.pumpRate;
    this.water = Math.max(0, this.water + net * dt);
  }

  // --- Derived condition the rest of the sim reads ---

  /** Fraction of complement still on their feet, 0..1. */
  get crewRatio(): number {
    return clamp(this.crew / this.cfg.complement, 0, 1);
  }

  /** Pump capacity now, scaled by the hands left to work them. */
  get pumpRate(): number {
    return this.cfg.pumpRate * this.crewRatio;
  }

  /** Weighted standing-mast factor 0..1 (the main counts most). */
  get mastFactor(): number {
    return (
      this.masts.fore * MAST_WEIGHT.fore +
      this.masts.main * MAST_WEIGHT.main +
      this.masts.mizzen * MAST_WEIGHT.mizzen
    );
  }

  /** Effective sail efficiency: cut rigging × standing masts. */
  get sailEfficiency(): number {
    return this.rigging * this.mastFactor;
  }

  /** Drive multiplier the sailing model applies to target surge. */
  get speedFactor(): number {
    return this.sailEfficiency;
  }

  /** Turning multiplier — masts and balanced canvas bring her round. */
  get turnFactor(): number {
    return this.mastFactor;
  }

  /** Rudder-authority multiplier the helm applies. */
  get steerFactor(): number {
    return this.rudder;
  }

  /** Reload / sail-handling speed multiplier from the crew left to work. */
  get crewFactor(): number {
    return clamp(this.crewRatio, this.cfg.minCrewFactor, 1);
  }

  /** True once the water in the hold has beaten her reserve buoyancy. */
  get sinking(): boolean {
    return this.water >= this.cfg.reserveBuoyancy;
  }
}
