import { describe, it, expect } from "vitest";
import { Rng } from "@core/rng";
import { World } from "./world";
import { Ship } from "./ship";

function makeWorld(): World {
  return new World(new Rng(1));
}

describe("World", () => {
  it("registers ships and returns the added ship", () => {
    const world = makeWorld();
    const ship = new Ship(0, 0, 0);
    expect(world.addShip(ship)).toBe(ship);
    expect(world.ships).toHaveLength(1);
    expect(world.ships[0]).toBe(ship);
  });

  it("advances simulated time by exactly dt per tick", () => {
    const world = makeWorld();
    world.tick(0.1);
    world.tick(0.1);
    expect(world.time).toBeCloseTo(0.2, 10);
  });

  it("ticks an empty world without error, still advancing time", () => {
    const world = makeWorld();
    expect(() => world.tick(0.05)).not.toThrow();
    expect(world.time).toBeCloseTo(0.05, 10);
  });

  it("updates each ship's pose against the new sim time", () => {
    const world = makeWorld();
    const ship = world.addShip(new Ship(2, 2, 0));
    const before = ship.pose.y;
    world.tick(1.0);
    // Pose recomputed at time = 1.0; heave should reflect the wave field there.
    expect(ship.pose.y).not.toBe(before);
  });

  it("is deterministic: identical worlds tick to identical poses", () => {
    const a = makeWorld();
    const b = makeWorld();
    a.addShip(new Ship(3, -1, 0.4));
    b.addShip(new Ship(3, -1, 0.4));
    for (let i = 0; i < 20; i++) {
      a.tick(1 / 60);
      b.tick(1 / 60);
    }
    expect(a.ships[0]!.pose).toEqual(b.ships[0]!.pose);
    expect(a.time).toBe(b.time);
  });

  describe("interpolatedPose", () => {
    it("returns the previous tick's pose at alpha = 0", () => {
      const world = makeWorld();
      world.addShip(new Ship(1, 1, 0));
      world.tick(0.5); // prev = initial pose (y 0), cur = pose at t=0.5
      const p = world.interpolatedPose(0, 0);
      expect(p.y).toBeCloseTo(0, 10); // initial heave
    });

    it("returns the current pose at alpha = 1", () => {
      const world = makeWorld();
      const ship = world.addShip(new Ship(1, 1, 0));
      world.tick(0.5);
      const p = world.interpolatedPose(0, 1);
      expect(p.y).toBeCloseTo(ship.pose.y, 10);
      expect(p.pitch).toBeCloseTo(ship.pose.pitch, 10);
      expect(p.roll).toBeCloseTo(ship.pose.roll, 10);
    });

    it("blends linearly between previous and current at alpha = 0.5", () => {
      const world = makeWorld();
      const ship = world.addShip(new Ship(1, 1, 0));
      world.tick(0.5);
      const p = world.interpolatedPose(0, 0.5);
      // x/z are fixed in P0, so they pass straight through.
      expect(p.x).toBe(1);
      expect(p.z).toBe(1);
      // Heave is the average of prev (0) and current.
      expect(p.y).toBeCloseTo(ship.pose.y * 0.5, 10);
    });
  });
});
