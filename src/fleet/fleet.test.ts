import { describe, it, expect } from "vitest";
import { Rng } from "@core/rng";
import { wrapAngle } from "@core/math";
import { World } from "@sim/world";
import { Ship, ShipStatus } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import type { Wind } from "@sim/wind";
import {
  Formation,
  stationFor,
  stationKeepingHeading,
  type FormationRef,
} from "./formation";
import { FleetSystem, Squadron } from "./squadron";

const WIND: Wind = { fromDir: 0, speed: 7 };
const DT = 1 / 60;

/** Distance from a point to a station, the metric station-keeping drives down. */
function dist(p: { x: number; z: number }, s: { x: number; z: number }): number {
  return Math.hypot(p.x - s.x, p.z - s.z);
}

describe("formation geometry", () => {
  it("lines a column ahead and astern of the flag along her course", () => {
    // Flag at the origin heading along +x (heading 0); van leads, rear trails.
    const ref: FormationRef = { x: 0, z: 0, heading: 0 };
    const interval = 80;

    // Flag in the van (index 0): the next ship is one interval astern (−x).
    const astern = stationFor(Formation.LineAhead, ref, 0, 1, interval);
    expect(astern.x).toBeCloseTo(-80);
    expect(astern.z).toBeCloseTo(0);
    expect(astern.heading).toBeCloseTo(0);

    // Flag amidships (index 1): index 0 is ahead, index 2 astern.
    const ahead = stationFor(Formation.LineAhead, ref, 1, 0, interval);
    const behind = stationFor(Formation.LineAhead, ref, 1, 2, interval);
    expect(ahead.x).toBeCloseTo(80);
    expect(behind.x).toBeCloseTo(-80);
  });

  it("spreads line abreast along the beam, not the course", () => {
    // Heading 0 → starboard is +z. Lower index sits to starboard of the flag.
    const ref: FormationRef = { x: 0, z: 0, heading: 0 };
    const star = stationFor(Formation.LineAbreast, ref, 1, 0, 50);
    const port = stationFor(Formation.LineAbreast, ref, 1, 2, 50);
    expect(star.x).toBeCloseTo(0);
    expect(star.z).toBeCloseTo(50);
    expect(port.z).toBeCloseTo(-50);
  });

  it("inherits the reference course at every station", () => {
    const ref: FormationRef = { x: 10, z: -5, heading: 1.2 };
    for (let i = 0; i < 4; i++) {
      expect(stationFor(Formation.LineAhead, ref, 1, i, 60).heading).toBeCloseTo(1.2);
    }
  });
});

describe("station-keeping controller", () => {
  it("steers onto the formation course once on station", () => {
    const station = { x: 30, z: -12, heading: 1.0 };
    const onStation = stationKeepingHeading({ x: 30, z: -12 }, station, 100);
    expect(onStation).toBeCloseTo(1.0);
  });

  it("angles toward the line when set off to one side", () => {
    // Station dead ahead on course π/2; follower 15 m to starboard (−x here).
    const station = { x: 0, z: -80, heading: Math.PI / 2 };
    const h = stationKeepingHeading({ x: 15, z: -80 }, station, 120);
    // She must steer past the formation course, back toward the column (+heading).
    expect(h).toBeGreaterThan(Math.PI / 2);
    expect(h).toBeLessThan(Math.PI / 2 + 0.3);
  });
});

describe("Squadron", () => {
  it("assigns the flag her own pose and the rest their stations", () => {
    const sq = new Squadron(7, [5, 7, 9], Formation.LineAhead, 80);
    expect(sq.flagIndex).toBe(1);

    const ref: FormationRef = { x: 100, z: 200, heading: 0 };
    const stations = sq.stations(ref);
    expect(stations.get(7)).toMatchObject({ x: 100, z: 200 }); // flag on herself
    expect(stations.get(5)!.x).toBeCloseTo(180); // van, one interval ahead
    expect(stations.get(9)!.x).toBeCloseTo(20); // rear, one interval astern
  });
});

describe("FleetSystem — conform to flag", () => {
  /** Flag plus two consorts, all on a beam reach under battle sail. */
  function makeSquadron(seed = 0xf1ee7) {
    const world = new World(new Rng(seed), WIND);
    // Heading π/2 on a beam reach (wind from 0): the column runs along ±z.
    const flag = world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
    // Both consorts start their proper distance astern but well off to one side.
    const second = world.addShip(new Ship(18, -80, Math.PI / 2, undefined, SailSet.Battle));
    const third = world.addShip(new Ship(-20, -160, Math.PI / 2, undefined, SailSet.Battle));
    const fleet = new FleetSystem(world);
    fleet.add(new Squadron(flag.id, [flag.id, second.id, third.id]));
    return { world, fleet, flag, second, third };
  }

  function step(world: World, fleet: FleetSystem, seconds: number): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      fleet.tick();
      world.tick(DT);
    }
  }

  it("pulls scattered consorts into line of battle", () => {
    const { world, fleet, flag, second, third } = makeSquadron();
    const sq = new Squadron(flag.id, [flag.id, second.id, third.id]);

    const stationsNow = () =>
      sq.stations({ x: flag.pose.x, z: flag.pose.z, heading: flag.heading });

    const before = stationsNow();
    const errBefore =
      dist(second.pose, before.get(second.id)!) + dist(third.pose, before.get(third.id)!);

    step(world, fleet, 180);

    const after = stationsNow();
    const errSecond = dist(second.pose, after.get(second.id)!);
    const errThird = dist(third.pose, after.get(third.id)!);

    // The line has closed up: both consorts end dressed within a hull-length or
    // two of their stations, down from tens of metres scattered.
    expect(errSecond + errThird).toBeLessThan(errBefore);
    expect(errSecond).toBeLessThan(6);
    expect(errThird).toBeLessThan(6);
    // And they are steering the flag's course, not still cutting across.
    expect(Math.abs(wrapAngle(second.heading - flag.heading))).toBeLessThan(0.05);
    expect(Math.abs(wrapAngle(third.heading - flag.heading))).toBeLessThan(0.05);
  });

  it("is deterministic from a seed", () => {
    const a = makeSquadron(0xabc);
    const b = makeSquadron(0xabc);
    step(a.world, a.fleet, 30);
    step(b.world, b.fleet, 30);
    expect(a.second.pose.x).toBe(b.second.pose.x);
    expect(a.third.pose.z).toBe(b.third.pose.z);
  });

  it("leaves a struck consort to her own devices", () => {
    const { world, fleet, second } = makeSquadron();
    second.status = ShipStatus.Struck;
    const held = second.targetHeading;
    fleet.tick();
    world.tick(DT);
    expect(second.targetHeading).toBe(held);
  });

  it("does not chase a flag that has struck or sunk", () => {
    const { world, fleet, flag, third } = makeSquadron();
    flag.status = ShipStatus.Sunk;
    const held = third.targetHeading;
    fleet.tick();
    world.tick(DT);
    expect(third.targetHeading).toBe(held);
  });
});
