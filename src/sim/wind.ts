/**
 * True wind and the angles a hull makes with it.
 *
 * Wind is described meteorologically — the direction it blows **from** — plus a
 * speed in m/s. v1 is a single constant wind per battle (gusts and shifts come
 * later). Everything here is pure and three.js-free.
 *
 * Frame note: `fromDir` and ship headings share the same yaw convention used
 * across the sim (see `sim/ship.ts`): an angle in radians about world up, with a
 * hull's forward axis = (cos ψ, sin ψ) in the XZ plane. A ship "head to wind"
 * has `heading === wind.fromDir` (true-wind angle 0).
 */
import { wrapAngle, clamp } from "@core/math";

export interface Wind {
  /** Direction the wind blows *from*, radians (same frame as ship heading). */
  fromDir: number;
  /** Wind speed, m/s. */
  speed: number;
}

/**
 * Reference wind speed (m/s) at which a class makes its rated `maxSpeed`. Drive
 * scales toward this and saturates a little above it — light air is slow, a
 * fresh breeze is fast, a gale doesn't make a square-rigger arbitrarily faster.
 */
export const REFERENCE_WIND_SPEED = 7;

/**
 * Signed true-wind angle in (−π, π]: the shortest arc from the wind-from
 * direction to the heading. Positive means the wind is on the ship's... it is
 * simply the signed bearing of the bow relative to the wind's source, used to
 * pick which way to tack/wear and which side is leeward.
 */
export function signedWindAngle(heading: number, wind: Wind): number {
  return wrapAngle(heading - wind.fromDir);
}

/** True-wind angle (TWA) magnitude in [0, π]: 0 = head to wind, π = dead astern. */
export function trueWindAngle(heading: number, wind: Wind): number {
  return Math.abs(signedWindAngle(heading, wind));
}

/**
 * How much of a class's rated speed this wind can drive. Linear below the
 * reference speed, gently saturating above it.
 */
export function windDriveFactor(speed: number): number {
  return clamp(speed / REFERENCE_WIND_SPEED, 0, 1.25);
}

/** Names of the points of sail, for the debug HUD. */
export type PointOfSail =
  | "In irons"
  | "No-go"
  | "Close-hauled"
  | "Beam reach"
  | "Broad reach"
  | "Running";

/**
 * Classify a true-wind angle into a point of sail for display. `nogo` is the
 * class's no-go half-width (radians); `inIrons` overrides the label when the
 * ship is actually stalled head to wind.
 */
export function pointOfSail(twa: number, nogo: number, inIrons: boolean): PointOfSail {
  if (inIrons) return "In irons";
  const deg = (twa * 180) / Math.PI;
  if (twa < nogo) return "No-go";
  if (deg < 80) return "Close-hauled";
  if (deg < 100) return "Beam reach";
  if (deg < 160) return "Broad reach";
  return "Running";
}
