/**
 * Ship simulation state for P0.
 *
 * This is the seed of the entity model. For now a ship is a buoyant rigid body
 * with a fixed horizontal position; it heaves, pitches, and rolls with the
 * waves. Later phases add sailing dynamics, gunnery, crew, and damage — but the
 * pose (`Pose`) is the stable interface the render layer interpolates.
 */
import { waveHeight } from "./waves";

/** A ship's full spatial state: position + orientation (radians). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number; // heading, rotation about world up (Y)
  pitch: number; // bow up/down
  roll: number; // port/starboard lean
}

export class Ship {
  /** Horizontal position is fixed in P0; only buoyancy moves the hull. */
  readonly homeX: number;
  readonly homeZ: number;
  readonly heading: number;

  /** Half-length/half-beam used to sample waves fore/aft and port/starboard. */
  private readonly halfLength = 4.5;
  private readonly halfBeam = 1.6;

  pose: Pose;

  constructor(x: number, z: number, heading = 0) {
    this.homeX = x;
    this.homeZ = z;
    this.heading = heading;
    this.pose = { x, y: 0, z, yaw: heading, pitch: 0, roll: 0 };
  }

  /**
   * Settle the hull onto the wave field at `time`. Heave is the wave height at
   * the hull centre; pitch comes from the height difference bow-to-stern and
   * roll from port-to-starboard, sampling the field at the hull's extents.
   * Fully deterministic for a given time.
   */
  update(time: number): void {
    const { homeX: x, homeZ: z, heading } = this;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);

    // Unit vectors for the hull's forward (along length) and right (along beam)
    // axes in world space. Heading 0 points along +X.
    const fwdX = cos;
    const fwdZ = sin;
    const rightX = -sin;
    const rightZ = cos;

    const centre = waveHeight(x, z, time);
    const bow = waveHeight(x + fwdX * this.halfLength, z + fwdZ * this.halfLength, time);
    const stern = waveHeight(x - fwdX * this.halfLength, z - fwdZ * this.halfLength, time);
    const port = waveHeight(x - rightX * this.halfBeam, z - rightZ * this.halfBeam, time);
    const star = waveHeight(x + rightX * this.halfBeam, z + rightZ * this.halfBeam, time);

    this.pose.y = centre;
    // Positive pitch = bow rises above stern.
    this.pose.pitch = Math.atan2(bow - stern, this.halfLength * 2);
    // Positive roll = starboard rises above port.
    this.pose.roll = Math.atan2(star - port, this.halfBeam * 2);
    this.pose.yaw = heading;
  }
}
