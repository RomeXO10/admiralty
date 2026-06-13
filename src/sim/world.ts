/**
 * The simulation world: the authoritative game state advanced in fixed steps.
 *
 * Holds entities and the deterministic clock. Crucially it keeps, for every
 * ship, both the previous and the current pose, so the render layer can blend
 * between them (`alpha` from the game loop) for motion that's smooth regardless
 * of frame rate. No three.js here — ever.
 */
import type { Rng } from "@core/rng";
import { lerp, lerpAngle } from "@core/math";
import { Ship, type Pose } from "./ship";
import type { Wind } from "./wind";

function clonePose(p: Pose): Pose {
  return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, roll: p.roll };
}

export class World {
  readonly ships: Ship[] = [];
  /** Parallel to `ships`: each entry is the pose at the *previous* tick. */
  private prevPoses: Pose[] = [];

  /** Authoritative simulated time (seconds), advanced only by `tick`. */
  time = 0;

  /** The battle's true wind — one constant vector in v1 (see `sim/wind.ts`). */
  readonly wind: Wind;

  constructor(
    readonly rng: Rng,
    wind: Wind,
  ) {
    this.wind = wind;
  }

  addShip(ship: Ship): Ship {
    this.ships.push(ship);
    this.prevPoses.push(clonePose(ship.pose));
    return ship;
  }

  /** Advance the whole world by exactly `dt` seconds. */
  tick(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.ships.length; i++) {
      const ship = this.ships[i]!;
      // Stash the pose we're leaving so render can interpolate from it.
      this.prevPoses[i] = clonePose(ship.pose);
      ship.step(dt, this.time, this.wind);
    }
  }

  /**
   * Pose for ship `index` interpolated `alpha` of the way from the previous
   * tick to the current one. Angles use shortest-arc interpolation.
   */
  interpolatedPose(index: number, alpha: number): Pose {
    const cur = this.ships[index]!.pose;
    const prev = this.prevPoses[index]!;
    return {
      x: lerp(prev.x, cur.x, alpha),
      y: lerp(prev.y, cur.y, alpha),
      z: lerp(prev.z, cur.z, alpha),
      yaw: lerpAngle(prev.yaw, cur.yaw, alpha),
      pitch: lerpAngle(prev.pitch, cur.pitch, alpha),
      roll: lerpAngle(prev.roll, cur.roll, alpha),
    };
  }
}
