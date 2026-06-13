/**
 * Table-driven speed polars — the heart of "honest, parametric" sailing.
 *
 * `drivePolar(twa)` returns a normalized drive factor in [0, 1] for a given
 * true-wind angle (TWA, the angle between the bow and the wind it blows *from*,
 * 0 = head to wind, π = dead downwind). It is **not** an analytic formula: it
 * interpolates an 8-point lookup table per rig type, so the curve is easy to
 * read, tune, and later author per ship class — see `docs/sailing-model.md` §5.
 *
 * Square riggers point poorly upwind (near-zero drive inside the no-go zone) and
 * are fastest on a broad reach (~120–130°). Fore-and-aft rigs point higher and
 * peak nearer a beam reach. That asymmetry is the tactical heart of the wind
 * game, and it lives entirely in these tables.
 *
 * Pure and three.js-free, like everything in `sim/`.
 */
import { clamp, TAU } from "@core/math";

/** One control point of a polar curve: drive factor at a true-wind angle. */
export interface PolarPoint {
  /** True-wind angle in degrees, 0 = head to wind, 180 = dead downwind. */
  twaDeg: number;
  /** Normalized drive factor in [0, 1]. */
  drive: number;
}

/**
 * Square rig (ships of the line, most frigates): dead inside ~60°, fastest on a
 * broad reach, slightly blanketed dead downwind.
 */
export const SQUARE_POLAR: readonly PolarPoint[] = [
  { twaDeg: 0, drive: 0.0 },
  { twaDeg: 30, drive: 0.0 },
  { twaDeg: 60, drive: 0.05 },
  { twaDeg: 80, drive: 0.55 },
  { twaDeg: 100, drive: 0.85 },
  { twaDeg: 130, drive: 1.0 },
  { twaDeg: 160, drive: 0.92 },
  { twaDeg: 180, drive: 0.8 },
];

/**
 * Fore-and-aft rig (cutters, schooners): points appreciably higher and peaks
 * nearer a beam reach; gives up some downwind drive in return.
 */
export const FORE_AFT_POLAR: readonly PolarPoint[] = [
  { twaDeg: 0, drive: 0.0 },
  { twaDeg: 30, drive: 0.0 },
  { twaDeg: 60, drive: 0.45 },
  { twaDeg: 80, drive: 0.8 },
  { twaDeg: 100, drive: 1.0 },
  { twaDeg: 130, drive: 0.95 },
  { twaDeg: 160, drive: 0.8 },
  { twaDeg: 180, drive: 0.65 },
];

/**
 * Sample a polar table at an arbitrary true-wind angle (radians, any sign — only
 * the magnitude folded into [0, π] matters since port/starboard are mirrored).
 *
 * Interpolation is a cardinal (Catmull-Rom) cubic Hermite spline over the
 * table's (possibly non-uniform) knots: it passes exactly through every control
 * point and stays smooth between them. The result is clamped to [0, 1] so cubic
 * overshoot can never produce negative drive or more than the peak.
 */
export function drivePolar(twaRad: number, table: readonly PolarPoint[] = SQUARE_POLAR): number {
  // Fold to [0, π]: the polar is symmetric about the wind line.
  let twa = Math.abs(((twaRad % TAU) + TAU) % TAU);
  if (twa > Math.PI) twa = TAU - twa;
  const x = (twa * 180) / Math.PI; // degrees, in [0, 180]

  const n = table.length;
  const first = table[0]!;
  const last = table[n - 1]!;
  if (x <= first.twaDeg) return clamp(first.drive, 0, 1);
  if (x >= last.twaDeg) return clamp(last.drive, 0, 1);

  // Find the segment [i, i+1] containing x.
  let i = 0;
  while (i < n - 1 && table[i + 1]!.twaDeg < x) i++;

  const p1 = table[i]!;
  const p2 = table[i + 1]!;
  const p0 = table[i - 1] ?? p1;
  const p3 = table[i + 2] ?? p2;

  // Non-uniform cardinal tangents: central difference over neighbouring knots.
  const m1 = (p2.drive - p0.drive) / (p2.twaDeg - p0.twaDeg);
  const m2 = (p3.drive - p1.drive) / (p3.twaDeg - p1.twaDeg);

  const h = p2.twaDeg - p1.twaDeg;
  const t = (x - p1.twaDeg) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  // Cubic Hermite basis.
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const y = h00 * p1.drive + h10 * h * m1 + h01 * p2.drive + h11 * h * m2;
  return clamp(y, 0, 1);
}
