import { describe, it, expect } from "vitest";
import { Ship, ShipStatus } from "./ship";
import { waveHeight } from "./waves";
import { SailSet } from "./shipClass";
import type { Wind } from "./wind";

const WIND: Wind = { fromDir: 0, speed: 7 };
/** Wind on the beam (from +Z) so a hull heading +X makes way on a reach. */
const BEAM_WIND: Wind = { fromDir: Math.PI / 2, speed: 7 };
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

describe("Ship — battle damage couples back into sailing (P3)", () => {
  it("loses way as her rigging and masts are shot away", () => {
    // Settle onto a steady beam reach, then take chain damage and watch her slow.
    const ship = new Ship(0, 0, 0, undefined, SailSet.Full);
    run(ship, 1200, BEAM_WIND);
    const fast = ship.surge;
    expect(fast).toBeGreaterThan(0.5);

    ship.damage.cutRigging(0.5);
    ship.damage.damageMast("main", 1); // main by the board
    run(ship, 1200, BEAM_WIND);
    expect(ship.surge).toBeLessThan(fast);
    expect(ship.damage.speedFactor).toBeLessThan(1);
  });

  it("a struck ship loses her drive and falls off the wind", () => {
    const ship = new Ship(0, 0, 0, undefined, SailSet.Full);
    run(ship, 600, BEAM_WIND);
    expect(ship.surge).toBeGreaterThan(0.5);

    ship.status = ShipStatus.Struck;
    ship.strike(); // furls sail, holds her head
    run(ship, 1800, BEAM_WIND);
    expect(ship.surge).toBeLessThan(0.05);
  });

  it("a sunk hull settles under the water as she goes down", () => {
    const ship = new Ship(0, 0, 0, undefined, SailSet.Furled);
    ship.status = ShipStatus.Sunk;
    const surface = waveHeight(0, 0, DT);
    ship.step(DT, DT, WIND);
    // Already dropping below the wave surface on the first sinking step.
    expect(ship.pose.y).toBeLessThan(surface);
    const firstDrop = ship.pose.y;
    run(ship, 60, WIND, DT);
    expect(ship.pose.y).toBeLessThan(firstDrop); // keeps going under
  });
});
