/**
 * Small, dependency-free math helpers shared across layers.
 *
 * Deliberately plain — `sim/` must not import three.js, so we keep our own
 * primitives here. The render layer can convert these to three.js types.
 */

export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  z: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation. `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle (radians) into [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest-arc interpolation between two angles (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}
