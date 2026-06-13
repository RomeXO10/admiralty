import { describe, it, expect } from "vitest";
import { Ship } from "./ship";
import { waveHeight } from "./waves";
import { SailSet } from "./shipClass";
import type { Wind } from "./wind";

const WIND: Wind = { fromDir: 0, speed: 7 };
const DT = 1 / 60;

/** Step a ship n times under the given wind, advancing sim time alongside. */
function run(ship: Ship, n: number, wind: Wind = WIND, t0 = 0): void {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += DT;
    ship.step(DT, t, wind);
  }
}

describe("Ship — construction & buoyancy", () => {
  it("starts at its home position with a level, given heading", () => {
    const ship = new Ship(10, -4, Math.PI / 3, undefined, SailSet.Furled);
    expect(ship.pose).toEqual({
      x: 10,
      y: 0,
      z: -4,
      yaw: Math.PI / 3,
      pitch: 0,
      roll: 0,
    });
    expect(ship.heading).toBe(Math.PI / 3);
    expect(ship.surge).toBe(0);
  });

  it("settles heave to the wave height at the hull centre", () => {
    // Furled and head-to-wind so it doesn't move; heave is pure buoyancy.
    const ship = new Ship(5, 2, 0, undefined, SailSet.Furled);
    ship.step(DT, 1.5, WIND);
    expect(ship.pose.y).toBeCloseTo(waveHeight(ship.pose.x, ship.pose.z, 1.5), 10);
  });

  it("produces finite pitch and roll over time", () => {
    const ship = new Ship(3, 3, 0.8, undefined, SailSet.Full);
    let t = 0;
    for (let i = 0; i < 600; i++) {
      t += DT;
      ship.step(DT, t, WIND);
      expect(Number.isFinite(ship.pose.pitch)).toBe(true);
      expect(Number.isFinite(ship.pose.roll)).toBe(true);
      expect(Math.abs(ship.pose.pitch)).toBeLessThan(Math.PI / 2);
      expect(Math.abs(ship.pose.roll)).toBeLessThan(Math.PI / 2);
    }
  });

  it("is deterministic: same construction + inputs gives the same state", () => {
    const a = new Ship(1, 2, 0.5);
    const b = new Ship(1, 2, 0.5);
    run(a, 300);
    run(b, 300);
    expect(a.pose).toEqual(b.pose);
    expect(a.heading).toBe(b.heading);
    expect(a.surge).toBe(b.surge);
  });

  it("keeps its yaw equal to its heading", () => {
    const ship = new Ship(0, 0, -1.2, undefined, SailSet.Full);
    run(ship, 120);
    expect(ship.pose.yaw).toBe(ship.heading);
  });
});
