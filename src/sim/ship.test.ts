import { describe, it, expect } from "vitest";
import { Ship } from "./ship";
import { waveHeight } from "./waves";

describe("Ship", () => {
  it("starts at its home position with a level, given heading", () => {
    const ship = new Ship(10, -4, Math.PI / 3);
    expect(ship.pose).toEqual({
      x: 10,
      y: 0,
      z: -4,
      yaw: Math.PI / 3,
      pitch: 0,
      roll: 0,
    });
  });

  it("settles heave to the wave height at the hull centre", () => {
    const ship = new Ship(5, 2, 0);
    ship.update(1.5);
    expect(ship.pose.y).toBeCloseTo(waveHeight(5, 2, 1.5), 10);
  });

  it("keeps horizontal position fixed in P0 (only buoyancy moves the hull)", () => {
    const ship = new Ship(8, -3, 1);
    ship.update(2);
    ship.update(4);
    expect(ship.pose.x).toBe(8);
    expect(ship.pose.z).toBe(-3);
  });

  it("holds yaw equal to its heading", () => {
    const heading = -1.2;
    const ship = new Ship(0, 0, heading);
    ship.update(3.3);
    expect(ship.pose.yaw).toBe(heading);
  });

  it("is deterministic: same construction + time gives the same pose", () => {
    const a = new Ship(1, 2, 0.5);
    const b = new Ship(1, 2, 0.5);
    a.update(2.75);
    b.update(2.75);
    expect(a.pose).toEqual(b.pose);
  });

  it("produces finite pitch and roll within a quarter turn", () => {
    const ship = new Ship(3, 3, 0.8);
    for (let t = 0; t < 10; t += 0.5) {
      ship.update(t);
      expect(Number.isFinite(ship.pose.pitch)).toBe(true);
      expect(Number.isFinite(ship.pose.roll)).toBe(true);
      expect(Math.abs(ship.pose.pitch)).toBeLessThan(Math.PI / 2);
      expect(Math.abs(ship.pose.roll)).toBeLessThan(Math.PI / 2);
    }
  });

  it("actually bobs: heave changes over time", () => {
    const ship = new Ship(0, 0, 0);
    ship.update(0);
    const y0 = ship.pose.y;
    ship.update(1.0);
    expect(ship.pose.y).not.toBeCloseTo(y0, 5);
  });
});
