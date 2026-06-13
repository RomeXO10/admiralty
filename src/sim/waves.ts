/**
 * Deterministic ocean surface — the *simulation's* model of the water.
 *
 * This is intentionally pure and three.js-free: given a world position and a
 * time, it returns the surface height and an approximate surface normal. The
 * render layer uses a visually similar shader, but the sim owns the canonical
 * heights so ship buoyancy/bobbing is reproducible from sim time alone.
 *
 * The field is a small sum of directional sine waves. Cheap, smooth, and good
 * enough for P0 "a boat bobbing on water". (The keep the wave parameters here
 * mirrored in the water shader so the visuals roughly agree.)
 */
import type { Vec2 } from "@core/math";

interface WaveComponent {
  /** Direction the wave travels (will be normalized). */
  dir: Vec2;
  amplitude: number;
  /** Wavelength in world units. */
  length: number;
  /** Phase speed in units/second. */
  speed: number;
}

const WAVES: readonly WaveComponent[] = [
  { dir: { x: 1, z: 0.35 }, amplitude: 0.55, length: 18, speed: 3.2 },
  { dir: { x: -0.4, z: 1 }, amplitude: 0.32, length: 11, speed: 2.4 },
  { dir: { x: 0.7, z: -0.6 }, amplitude: 0.18, length: 6.5, speed: 1.8 },
];

export interface NormalizedWave extends WaveComponent {
  nx: number;
  nz: number;
  k: number; // angular wavenumber 2π/length
  omega: number; // angular frequency k*speed
}

/**
 * The compiled wave components. Exported so the water shader can reproduce the
 * exact same field the sim uses for buoyancy — keeping hull and water visually
 * in agreement.
 */
export const WAVE_COMPONENTS: readonly NormalizedWave[] = WAVES.map((w) => {
  const len = Math.hypot(w.dir.x, w.dir.z) || 1;
  const k = (Math.PI * 2) / w.length;
  return {
    ...w,
    nx: w.dir.x / len,
    nz: w.dir.z / len,
    k,
    omega: k * w.speed,
  };
});

/** Surface height (world Y) at a horizontal position and time. */
export function waveHeight(x: number, z: number, time: number): number {
  let h = 0;
  for (const w of WAVE_COMPONENTS) {
    const phase = (w.nx * x + w.nz * z) * w.k - w.omega * time;
    h += Math.sin(phase) * w.amplitude;
  }
  return h;
}

/**
 * Approximate upward surface normal at a position/time, from the analytic
 * partial derivatives of the height field. Used to tilt a floating hull.
 */
export function waveNormal(
  x: number,
  z: number,
  time: number,
): { x: number; y: number; z: number } {
  let dhdx = 0;
  let dhdz = 0;
  for (const w of WAVE_COMPONENTS) {
    const phase = (w.nx * x + w.nz * z) * w.k - w.omega * time;
    const d = Math.cos(phase) * w.amplitude * w.k;
    dhdx += d * w.nx;
    dhdz += d * w.nz;
  }
  // Normal of surface y = h(x,z) is (-dh/dx, 1, -dh/dz), normalized.
  const nx = -dhdx;
  const nz = -dhdz;
  const len = Math.hypot(nx, 1, nz) || 1;
  return { x: nx / len, y: 1 / len, z: nz / len };
}
