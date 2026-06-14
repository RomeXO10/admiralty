import { describe, it, expect } from "vitest";
import { Rng } from "@core/rng";
import { World } from "./world";
import { Ship, ShipStatus } from "./ship";
import { SailSet } from "./shipClass";
import { BatterySide, ShotType } from "./battery";
import type { Wind } from "./wind";
import {
  GunnerySystem,
  FireControl,
  DEFAULT_GUNNERY,
  accuracy,
  shotRangeMod,
  aspectFactor,
  isRake,
  rollTimingFactor,
} from "./gunnery";

// Wind on the beam (from +Z) so a hull heading +X is on a beam reach making way.
const WIND: Wind = { fromDir: Math.PI / 2, speed: 7 };
const DT = 1 / 60;
const CFG = DEFAULT_GUNNERY;

/**
 * Two frigates running side by side on a beam reach 40 m apart — identical
 * dynamics keep them in formation, so each holds the other in her broadside arc
 * for a sustained duel. Ship A's starboard battery bears on B (+Z); B's port
 * battery bears on A.
 */
function duel(seed = 0xba771e) {
  const world = new World(new Rng(seed), WIND);
  const a = world.addShip(new Ship(0, -20, 0, undefined, SailSet.Furled));
  const b = world.addShip(new Ship(0, 20, 0, undefined, SailSet.Furled));
  const gun = new GunnerySystem(world);
  return { world, a, b, gun };
}

/**
 * Two frigates frozen in place (no wind, so no way and no drift) 40 m apart, A's
 * starboard bearing on B for as long as we like. This isolates the gunnery
 * progression from any sailing drift so we can watch damage mount tick by tick.
 */
function staticPair(seed = 0x57a71c) {
  const world = new World(new Rng(seed), { fromDir: Math.PI, speed: 0 });
  const a = world.addShip(new Ship(0, -20, 0, undefined, SailSet.Furled));
  const b = world.addShip(new Ship(0, 20, 0, undefined, SailSet.Furled));
  const gun = new GunnerySystem(world);
  return { world, a, b, gun };
}

/** Mirror the game loop: move the world, then resolve the guns. */
function step(world: World, gun: GunnerySystem, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.tick(DT);
    gun.tick(DT);
  }
}

describe("gunnery geometry — the pure resolution helpers", () => {
  it("accuracy peaks at point-blank and falls to a floor by max range", () => {
    expect(accuracy(0, CFG)).toBe(1);
    expect(accuracy(CFG.pointBlankRange, CFG)).toBe(1);
    expect(accuracy(CFG.maxRange, CFG)).toBe(CFG.accuracyFloor);
    expect(accuracy(CFG.maxRange + 100, CFG)).toBe(CFG.accuracyFloor);
    // Monotonically decreasing in between.
    expect(accuracy(100, CFG)).toBeGreaterThan(accuracy(250, CFG));
    expect(accuracy(250, CFG)).toBeGreaterThan(accuracy(380, CFG));
  });

  it("makes grape a close-range shot only", () => {
    expect(shotRangeMod(ShotType.Grape, CFG.grapeRange, CFG)).toBe(1);
    expect(shotRangeMod(ShotType.Grape, CFG.grapeRange + CFG.grapeFalloff, CFG)).toBe(0);
    // Round and chain carry to full range.
    expect(shotRangeMod(ShotType.Round, 300, CFG)).toBe(1);
    expect(shotRangeMod(ShotType.Chain, 300, CFG)).toBe(1);
  });

  it("reads a beam-on target as a larger target than an end-on one", () => {
    const firer = new Ship(0, -20, 0);
    const beamOn = new Ship(0, 20, 0); // shows her side to the line of fire
    const endOn = new Ship(0, 20, Math.PI / 2); // bow-on to the line of fire
    expect(aspectFactor(firer, beamOn, CFG)).toBeGreaterThan(aspectFactor(firer, endOn, CFG));
    expect(aspectFactor(firer, beamOn, CFG)).toBeCloseTo(CFG.aspectMax, 6);
  });

  it("recognizes a rake across the bow or stern, but not across the beam", () => {
    const target = new Ship(0, 0, 0); // bow points +X
    expect(isRake(new Ship(50, 0, 0), target, CFG)).toBe(true); // off the bow
    expect(isRake(new Ship(-50, 0, 0), target, CFG)).toBe(true); // off the stern
    expect(isRake(new Ship(0, 50, 0), target, CFG)).toBe(false); // on the beam
  });

  it("rewards firing on the roll phase that matches the shot", () => {
    // Starboard battery: starboard rises with positive roll.
    const downRoll = -0.1; // muzzles depressed — good for round into the hull
    const upRoll = 0.1; // muzzles raised — good for chain into the rigging
    expect(rollTimingFactor(downRoll, BatterySide.Starboard, ShotType.Round, CFG)).toBeGreaterThan(
      rollTimingFactor(upRoll, BatterySide.Starboard, ShotType.Round, CFG),
    );
    expect(rollTimingFactor(upRoll, BatterySide.Starboard, ShotType.Chain, CFG)).toBeGreaterThan(
      rollTimingFactor(downRoll, BatterySide.Starboard, ShotType.Chain, CFG),
    );
    // Grape is unaffected by roll; always the base factor; all stay within bounds.
    expect(rollTimingFactor(0.2, BatterySide.Starboard, ShotType.Grape, CFG)).toBeCloseTo(
      CFG.baseRollTiming,
      10,
    );
    expect(rollTimingFactor(99, BatterySide.Starboard, ShotType.Round, CFG)).toBeLessThanOrEqual(1);
    expect(
      rollTimingFactor(99, BatterySide.Starboard, ShotType.Chain, CFG),
    ).toBeGreaterThanOrEqual(CFG.minRollTiming);
  });
});

describe("GunnerySystem — firing", () => {
  it("a bearing, loaded broadside hurts the target", () => {
    const { gun, a, b } = duel();
    gun.arm(a.id, { target: b.id });
    gun.fireBroadside(a.id);
    expect(gun.volleys.length).toBe(1);
    expect(gun.volleys[0]?.side).toBe(BatterySide.Starboard);
    expect(b.damage.hull).toBeLessThan(1);
    expect(b.damage.crew).toBeLessThan(b.shipClass.damage.complement);
  });

  it("does not fire when no broadside bears", () => {
    const { world, gun, a } = duel();
    const ahead = world.addShip(new Ship(80, -20, 0, undefined, SailSet.Furled)); // dead ahead of A
    gun.arm(a.id, { target: ahead.id });
    gun.fireBroadside(a.id);
    expect(gun.volleys.length).toBe(0);
    expect(ahead.damage.hull).toBe(1);
  });

  it("cannot fire again until the guns have reloaded", () => {
    const { gun, a, b } = duel();
    gun.arm(a.id, { target: b.id, fireControl: FireControl.Hold });
    gun.fireBroadside(a.id);
    gun.fireBroadside(a.id); // immediately — guns are empty
    expect(gun.volleys.length).toBe(1);
  });

  it("holds fire under a Hold order even with a target bearing", () => {
    const { gun, a, b, world } = duel();
    gun.arm(a.id, { target: b.id, fireControl: FireControl.Hold });
    step(world, gun, 60);
    expect(gun.volleys.length).toBe(0);
    expect(b.damage.hull).toBe(1);
  });
});

describe("GunnerySystem — a duel runs to a result", () => {
  it("ends with one ship struck or sunk, and logs the outcome", () => {
    const { world, gun, a, b } = duel();
    gun.arm(a.id, { target: b.id });
    gun.arm(b.id, { target: a.id });

    let ended = false;
    for (let t = 0; t < 600 && !ended; t += 1) {
      step(world, gun, 1);
      ended = a.status !== ShipStatus.Fighting || b.status !== ShipStatus.Fighting;
    }

    expect(ended).toBe(true);
    expect(gun.reports.length).toBeGreaterThan(0);
    const loser = a.status !== ShipStatus.Fighting ? a : b;
    expect([ShipStatus.Struck, ShipStatus.Sunk]).toContain(loser.status);
    expect(gun.reports.some((r) => r.shipId === loser.id)).toBe(true);
  });

  it("is deterministic: the same seed gives the same duel", () => {
    function run() {
      const { world, gun, a, b } = duel(0x1234);
      gun.arm(a.id, { target: b.id });
      gun.arm(b.id, { target: a.id });
      for (let t = 0; t < 600; t++) {
        step(world, gun, 1);
        if (a.status !== ShipStatus.Fighting || b.status !== ShipStatus.Fighting) break;
      }
      const first = gun.reports[0];
      return { loser: first?.shipId, outcome: first?.outcome, at: first?.atTime };
    }
    expect(run()).toEqual(run());
  });

  it("samples the same duel identically when re-run (mid-fight, not just the end)", () => {
    // Determinism isn't only an end-state property: the whole trajectory matches.
    function trace() {
      const { world, gun, a, b } = duel(0x77aa);
      gun.arm(a.id, { target: b.id });
      gun.arm(b.id, { target: a.id });
      const samples: number[] = [];
      for (let t = 0; t < 90; t++) {
        step(world, gun, 1);
        samples.push(Math.round(b.damage.hull * 1e6), b.damage.crew, gun.volleys.length);
      }
      return samples;
    }
    expect(trace()).toEqual(trace());
  });

  it("a struck ship ceases fire and furls her sails", () => {
    const { world, gun, a, b } = duel();
    gun.arm(a.id, { target: b.id });
    gun.arm(b.id, { target: a.id });
    for (let t = 0; t < 600; t++) {
      step(world, gun, 1);
      if (a.status === ShipStatus.Struck || b.status === ShipStatus.Struck) break;
    }
    const struck = a.status === ShipStatus.Struck ? a : b.status === ShipStatus.Struck ? b : null;
    if (struck) {
      const volleysAfter = gun.volleys.filter(
        (v) => v.firerId === struck.id && v.atTime > gun.reports[0]!.atTime,
      );
      expect(volleysAfter.length).toBe(0);
      expect(struck.sailSet).toBe(SailSet.Furled);
    }
  });
});

describe("GunnerySystem — the fight as it develops (in-between steps)", () => {
  it("mounts hull and crew damage monotonically, volley after volley", () => {
    const { world, gun, a, b } = staticPair();
    gun.arm(a.id, { target: b.id }); // only A fires; B is a passive target

    const hull: number[] = [];
    const crew: number[] = [];
    const morale: number[] = [];
    for (let t = 0; t < 120; t++) {
      step(world, gun, 1);
      hull.push(b.damage.hull);
      crew.push(b.damage.crew);
      morale.push(b.damage.morale);
    }

    // Each location only ever worsens — damage never spontaneously heals.
    for (let i = 1; i < hull.length; i++) {
      expect(hull[i]!).toBeLessThanOrEqual(hull[i - 1]! + 1e-9);
      expect(crew[i]!).toBeLessThanOrEqual(crew[i - 1]!);
      expect(morale[i]!).toBeLessThanOrEqual(morale[i - 1]! + 1e-9);
    }
    // …and by the end she is well down from where she started.
    expect(hull.at(-1)!).toBeLessThan(hull[0]!);
    expect(crew.at(-1)!).toBeLessThan(b.shipClass.damage.complement);
    expect(morale.at(-1)!).toBeLessThan(1);
  });

  it("floods through rising intermediate water before she founders", () => {
    const { world, gun, a, b } = staticPair();
    gun.arm(a.id, { target: b.id });

    const reserve = b.shipClass.damage.reserveBuoyancy;
    let sawPartialFlood = false;
    let lastWater = 0;
    let everRose = false;
    for (let t = 0; t < 400 && !b.damage.sinking; t++) {
      step(world, gun, 1);
      const w = b.damage.water;
      if (w > 0 && w < reserve) sawPartialFlood = true;
      if (w > lastWater) everRose = true;
      lastWater = w;
    }

    expect(b.damage.floodRate).toBeGreaterThan(0); // holes below the waterline
    expect(sawPartialFlood).toBe(true); // taking water but still afloat — the in-between
    expect(everRose).toBe(true);
    expect(b.damage.sinking).toBe(true); // and eventually the water wins
  });

  it("brings down masts with chain shot and reports the dismasting mid-fight", () => {
    const { world, gun, a, b } = staticPair();
    gun.arm(a.id, { target: b.id });
    gun.setShot(a.id, ShotType.Chain); // aim for the rigging

    for (let t = 0; t < 400 && b.damage.mastFactor >= 0.34; t++) step(world, gun, 1);

    expect(b.damage.rigging).toBeLessThan(1);
    expect(Object.values(b.damage.masts).some((m) => m === 0)).toBe(true);
    // Dismasting is a milestone *before* the end: she's reported, yet still afloat
    // and unstruck (chain neither floods her nor, as a passive target, strikes her).
    const report = gun.reports.find((r) => r.shipId === b.id && r.outcome === "dismasted");
    expect(report).toBeDefined();
    expect(b.status).toBe(ShipStatus.Fighting);
    expect(b.damage.speedFactor).toBeLessThan(1); // and she now sails worse
  });

  it("fires on a reload cadence, not continuously", () => {
    const { world, gun, a, b } = staticPair();
    gun.arm(a.id, { target: b.id });
    step(world, gun, 100);

    const stb = gun.volleys
      .filter((v) => v.firerId === a.id && v.side === BatterySide.Starboard)
      .map((v) => v.atTime);
    expect(stb.length).toBeGreaterThan(2); // several volleys over the run
    const reload = a.batteries.find((bat) => bat.side === BatterySide.Starboard)!.baseReload;
    for (let i = 1; i < stb.length; i++) {
      // Consecutive volleys are at least a (full-crew) reload apart — never spammed.
      expect(stb[i]! - stb[i - 1]!).toBeGreaterThanOrEqual(reload * 0.9);
    }
  });
});
