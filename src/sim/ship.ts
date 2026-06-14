/**
 * Ship simulation — P1: a hull that sails honestly.
 *
 * On top of P0's wave-driven buoyancy, a ship now has sailing dynamics: a true
 * wind drives it through a speed polar, it gathers and loses way with momentum,
 * slips to leeward, steers only when it has steerage, and can tack or wear
 * through the wind — failing into irons if it tries with too little way on. The
 * full model is specified in `docs/sailing-model.md`.
 *
 * Conventions (unchanged from P0): the sea is the XZ plane, `y` is up, heading ψ
 * is yaw about Y with forward = (cos ψ, sin ψ) and starboard = (−sin ψ, cos ψ).
 * `Pose` stays the stable interface the render layer interpolates. Pure, no
 * three.js, deterministic from initial state + wind + helm inputs.
 */
import { clamp, wrapAngle, TAU, type Vec2 } from "@core/math";
import { waveHeight } from "./waves";
import { signedWindAngle, windDriveFactor, type Wind } from "./wind";
import { drivePolar } from "./polar";
import { SAIL_TRIM, SailSet, FRIGATE_SQUARE, type ShipClass } from "./shipClass";
import { DamageState } from "./damage";
import { Battery } from "./battery";

/** A ship's full spatial state: position + orientation (radians). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number; // heading, rotation about world up (Y)
  pitch: number; // bow up/down
  roll: number; // port/starboard lean
}

/** Where a ship stands in the fight (P3). */
export enum ShipStatus {
  /** Still under command and able to fight. */
  Fighting = "Fighting",
  /** Struck her colors: surrendered, ceased fire, heaving to. */
  Struck = "Struck",
  /** Flooding has beaten her buoyancy; she is going down. */
  Sunk = "Sunk",
}

/** Helm band (rad): heading error beyond this commands full rudder. */
const STEER_BAND = 0.35;
/** Heading error (rad) under which a forced tack/wear turn is "complete". */
const MANEUVER_DONE = 0.05;
/** Angle remaining (rad) over which a forced swing eases out to meet the helm. */
const MANEUVER_EASE = 1.0;
/** Clear of the no-go by this margin (rad) before a stalled ship draws again. */
const IRONS_RECOVER_MARGIN = 0.08;

/** Seconds for a sinking hull to settle fully under, for the render layer. */
const SINK_TIME = 12;
/** How far (m) a fully sunk hull drops below the waterline. */
const SINK_DEPTH = 7;
/** Final list (rad) a sinking hull heels to as she goes. */
const SINK_LIST = 0.6;

export class Ship {
  /** Stable identity within a {@link World}, assigned by `World.addShip`. */
  id = 0;
  readonly shipClass: ShipClass;

  // --- Horizontal sailing state (the authoritative navigation state) ---
  /** Heading ψ in radians; the bow points along (cos ψ, sin ψ). */
  heading: number;
  /** Forward speed along the heading, m/s (≥ 0). */
  surge = 0;
  /** Yaw rate, rad/s. */
  yawRate = 0;
  /** Rudder deflection in [-1, 1], set by the helm each step. */
  rudder = 0;
  /** World-space velocity (surge + leeway), m/s — exposed for the HUD. */
  velocity: Vec2 = { x: 0, z: 0 };

  // --- Rig state ---
  /** Ordered sail state; the crew works the trim toward it over time. */
  sailSet: SailSet;
  /** Continuous trim fraction in [0, 1] easing toward the ordered sail set. */
  trim: number;

  // --- Maneuver state ---
  /** Ordered course the helm steers toward (radians). */
  targetHeading: number;
  /**
   * While tacking/wearing, a forced turn direction (±1) that overrides the
   * shortest-arc helm until the swing completes; 0 means normal steering.
   */
  private forcedTurn: -1 | 0 | 1 = 0;
  /** The maneuver the forced turn is carrying out (for telemetry/HUD). */
  maneuver: "none" | "tack" | "wear" = "none";
  /** True when stalled head to wind with no steerage — see {@link step}. */
  inIrons = false;
  /** Last computed true-wind angle (rad), cached for the HUD. */
  twa = 0;

  // --- Combat state (P3) ---
  /** The guns she carries, built from her class (see `battery.ts`). */
  readonly batteries: Battery[];
  /** Her localized condition: hull, masts, rigging, rudder, crew, morale. */
  readonly damage: DamageState;
  /** Where she stands in the fight. */
  status: ShipStatus = ShipStatus.Fighting;
  /** Progress of a sinking hull settling under, 0..1 (render only). */
  private sinkT = 0;

  pose: Pose;

  constructor(
    x: number,
    z: number,
    heading = 0,
    shipClass: ShipClass = FRIGATE_SQUARE,
    sailSet: SailSet = SailSet.Battle,
  ) {
    this.shipClass = shipClass;
    this.heading = heading;
    this.targetHeading = heading;
    this.sailSet = sailSet;
    // Start already carrying its ordered canvas so the demo sails from t=0.
    this.trim = SAIL_TRIM[sailSet];
    this.pose = { x, y: 0, z, yaw: heading, pitch: 0, roll: 0 };
    this.batteries = shipClass.batteries.map((spec) => new Battery(spec));
    this.damage = new DamageState(shipClass.damage);
  }

  /**
   * Strike the colors: cease fire and heave to. The hull stays in the world (it
   * can be taken as a prize); the gunnery layer sets {@link status} and calls this.
   */
  strike(): void {
    this.setSail(SailSet.Furled);
    this.setHelm(this.heading);
  }

  // --- Helm / order interface (a placeholder for P2's captain layer) ---

  /** Steer toward an absolute heading by the shortest arc. */
  setHelm(heading: number): void {
    this.targetHeading = wrapAngle(heading);
    this.forcedTurn = 0;
    this.maneuver = "none";
  }

  /** Nudge the ordered heading by a delta (radians). */
  nudgeHelm(delta: number): void {
    this.setHelm(this.targetHeading + delta);
  }

  /** Order a sail state; the crew works toward it over `sailTrimTime`. */
  setSail(sailSet: SailSet): void {
    this.sailSet = sailSet;
  }

  /** Make one step more sail (Furled→Reduced→Battle→Full). */
  makeSail(): void {
    if (this.sailSet < SailSet.Full) this.setSail((this.sailSet + 1) as SailSet);
  }

  /** Take in one step of sail. */
  reduceSail(): void {
    if (this.sailSet > SailSet.Furled) this.setSail((this.sailSet - 1) as SailSet);
  }

  /**
   * Tack: swing the bow *through* the wind to the mirrored course on the other
   * board (the short way). Fast but risky — too little way on and she misses
   * stays into irons.
   */
  tack(wind: Wind): void {
    const sw = signedWindAngle(this.heading, wind);
    this.targetHeading = wrapAngle(2 * wind.fromDir - this.heading);
    this.forcedTurn = sw > 0 ? -1 : 1; // turn toward, then through, the wind
    this.maneuver = "tack";
  }

  /**
   * Wear: bring the stern through the wind (the long way round). Slower and
   * costs ground to leeward, but never misses stays.
   */
  wear(wind: Wind): void {
    const sw = signedWindAngle(this.heading, wind);
    this.targetHeading = wrapAngle(2 * wind.fromDir - this.heading);
    this.forcedTurn = sw > 0 ? 1 : -1; // turn away from the wind, the long way
    this.maneuver = "wear";
  }

  // --- Simulation step ---

  /**
   * Advance the ship by `dt` seconds under `wind`, then settle the hull onto the
   * wave field at `time`. Order of operations matters: drive and steering use
   * this step's state, then position integrates with the freshly updated
   * heading, then buoyancy reads the new position.
   */
  step(dt: number, time: number, wind: Wind): void {
    const c = this.shipClass;

    // Flooding vs. pumps runs every tick, independent of how she's handled.
    this.damage.step(dt);

    const sw = signedWindAngle(this.heading, wind);
    this.twa = Math.abs(sw);

    // --- In-irons state: stalled head to wind with no way to steer ---
    // A ship that finds itself inside the no-go with too little way to drive or
    // steer has missed stays. This trips whether she drifted up there or tried
    // to tack with too little way on — a well-found tack keeps surge above the
    // threshold through the swing and rides clean onto the new board.
    if (!this.inIrons && this.twa < c.nogoAngle && this.surge < c.tackThreshold) {
      this.inIrons = true;
      this.forcedTurn = 0;
      this.maneuver = "none";
    } else if (this.inIrons && this.twa >= c.nogoAngle + IRONS_RECOVER_MARGIN) {
      this.inIrons = false; // fallen off far enough to draw again
    }

    // --- Make/reduce sail: ease trim toward the ordered set ---
    const targetTrim = SAIL_TRIM[this.sailSet];
    const maxTrimStep = dt / c.sailTrimTime;
    this.trim += clamp(targetTrim - this.trim, -maxTrimStep, maxTrimStep);

    // --- Drive & surge (momentum via asymmetric relaxation) ---
    // A dismasted or short-rigged hull makes less of her rated speed; a struck
    // or sinking ship drives no more (her canvas is in any case coming down).
    let targetSurge = 0;
    if (this.status === ShipStatus.Fighting && !this.inIrons && this.twa >= c.nogoAngle) {
      targetSurge =
        c.maxSpeed *
        drivePolar(this.twa, c.polar) *
        this.trim *
        windDriveFactor(wind.speed) *
        this.damage.speedFactor;
    }
    const tau = targetSurge > this.surge ? c.tauUp : c.tauDown;
    this.surge += (targetSurge - this.surge) * Math.min(dt / tau, 1);
    if (this.surge < 0) this.surge = 0;

    // --- Steering ---
    if (this.inIrons) {
      // Helm is dead; the bow slowly falls off toward the nearer board until
      // she draws again. Push away from the wind line (increase |TWA|).
      const fallDir = sw >= 0 ? 1 : -1;
      this.yawRate = 0;
      this.rudder = 0;
      this.heading = wrapAngle(this.heading + c.ironsFallOffRate * fallDir * dt);
    } else {
      let targetYaw: number;
      if (this.forcedTurn !== 0) {
        // Committed tack/wear: swing the bow at the maneuver rate — way and the
        // crew at the braces carry her round, independent of rudder authority.
        // The shortest-arc helm can't be used (a 180° swing is ±π ambiguous),
        // so track the angle still to turn in the committed direction and ease
        // the swing out over the last stretch so she meets the new heading.
        const dir = this.forcedTurn;
        const raw = dir > 0 ? this.targetHeading - this.heading : this.heading - this.targetHeading;
        const rem = ((raw % TAU) + TAU) % TAU; // [0, TAU): angle left to turn
        this.rudder = dir;
        targetYaw = dir * c.maneuverYawRate * this.damage.turnFactor * Math.min(1, rem / MANEUVER_EASE);
        if (rem < MANEUVER_DONE || rem > TAU - MANEUVER_DONE) {
          this.forcedTurn = 0;
          this.maneuver = "none";
        }
      } else {
        // Normal helm: rudder proportional to heading error, gated by steerage.
        // A shot-away rudder bleeds authority; damaged rig slows the swing.
        const err = wrapAngle(this.targetHeading - this.heading);
        this.rudder = clamp(err / STEER_BAND, -1, 1);
        const rudderAuth = clamp(this.surge / c.steerageSpeed, 0, 1) * this.damage.steerFactor;
        targetYaw = c.turnRate * this.damage.turnFactor * rudderAuth * this.rudder;
      }
      this.yawRate += (targetYaw - this.yawRate) * Math.min(dt / c.tauYaw, 1);
      this.heading = wrapAngle(this.heading + this.yawRate * dt);
    }

    // --- Compose velocity: surge along the heading + leeway to leeward ---
    const cos = Math.cos(this.heading);
    const sin = Math.sin(this.heading);
    const fwdX = cos;
    const fwdZ = sin;

    // Leeway is the component of the downwind direction perpendicular to the
    // heading. It peaks close-hauled and vanishes when running dead downwind.
    const windToX = -Math.cos(wind.fromDir);
    const windToZ = -Math.sin(wind.fromDir);
    const along = windToX * fwdX + windToZ * fwdZ;
    let perpX = windToX - along * fwdX;
    let perpZ = windToZ - along * fwdZ;
    const perpLen = Math.hypot(perpX, perpZ);
    let leewayX = 0;
    let leewayZ = 0;
    const sideFactor = Math.sin(this.twa) * (1 - this.twa / Math.PI);
    if (perpLen > 1e-6) {
      const leewaySpeed = c.maxSpeed * c.leewayCoeff * sideFactor * windDriveFactor(wind.speed);
      perpX /= perpLen;
      perpZ /= perpLen;
      leewayX = perpX * leewaySpeed;
      leewayZ = perpZ * leewaySpeed;
    }

    this.velocity.x = fwdX * this.surge + leewayX;
    this.velocity.z = fwdZ * this.surge + leewayZ;
    this.pose.x += this.velocity.x * dt;
    this.pose.z += this.velocity.z * dt;

    // --- Heel from side force: lean to leeward (a gunnery hook later) ---
    const rightX = -sin;
    const rightZ = cos;
    const leewardOnStarboard = perpX * rightX + perpZ * rightZ; // sign
    const heel =
      -Math.sign(leewardOnStarboard) *
      c.maxHeel *
      sideFactor *
      this.trim *
      windDriveFactor(wind.speed);

    // --- Buoyancy: settle onto the wave field at the new position ---
    this.settle(time, fwdX, fwdZ, rightX, rightZ, heel);
    this.pose.yaw = this.heading;

    // A sunk hull keeps drifting but settles under with a growing list.
    if (this.status === ShipStatus.Sunk) {
      this.sinkT = Math.min(1, this.sinkT + dt / SINK_TIME);
      this.pose.y -= this.sinkT * SINK_DEPTH;
      this.pose.roll += this.sinkT * SINK_LIST;
    }
  }

  /**
   * Sample the wave field at the hull's extents to set heave (centre height),
   * pitch (bow-to-stern), and roll (port-to-starboard), then add sailing heel.
   * Split out from {@link step} so the geometry reads cleanly. Deterministic for
   * a given position + time.
   */
  private settle(
    time: number,
    fwdX: number,
    fwdZ: number,
    rightX: number,
    rightZ: number,
    heel: number,
  ): void {
    const { x, z } = this.pose;
    const { halfLength, halfBeam } = this.shipClass;

    const centre = waveHeight(x, z, time);
    const bow = waveHeight(x + fwdX * halfLength, z + fwdZ * halfLength, time);
    const stern = waveHeight(x - fwdX * halfLength, z - fwdZ * halfLength, time);
    const port = waveHeight(x - rightX * halfBeam, z - rightZ * halfBeam, time);
    const star = waveHeight(x + rightX * halfBeam, z + rightZ * halfBeam, time);

    this.pose.y = centre;
    // Positive pitch = bow rises above stern.
    this.pose.pitch = Math.atan2(bow - stern, halfLength * 2);
    // Positive roll = starboard rises above port; heel adds the wind's lean.
    this.pose.roll = Math.atan2(star - port, halfBeam * 2) + heel;
  }
}
