import { describe, it, expect } from "vitest";
import { Rng } from "@core/rng";
import { wrapAngle } from "@core/math";
import { World } from "@sim/world";
import { Ship } from "@sim/ship";
import { SailSet } from "@sim/shipClass";
import type { Wind } from "@sim/wind";
import { OrderType } from "./order";
import { CRACK_CAPTAIN, RAW_CAPTAIN } from "./captain";
import type { SignalConfig } from "./signal";
import { DEFAULT_SIGNALS } from "./signal";
import { CommandSystem, SignalStage } from "./commandSystem";

const WIND: Wind = { fromDir: 0, speed: 7 };
const DT = 1 / 60;

/**
 * A brisk latency config so the pipeline resolves in a handful of seconds of sim
 * time. Misread is disabled so behaviour-and-heading assertions are exact; tests
 * that care about misreads override it.
 */
const FAST: SignalConfig = {
  tHoist: 1,
  baseLook: 1,
  rangePenaltyPerMetre: 0.001,
  signalRange: 600,
  baseComprehend: 1,
  baseMisread: 0,
  maxMisread: 0,
};

/** Step the command layer then the world, mirroring the real game loop order. */
function step(world: World, cmd: CommandSystem, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    cmd.tick(DT);
    world.tick(DT);
  }
}

/** A flagship and a consort 20 m off, both on a beam reach making way. */
function makeWorld(seed = 0xc0de) {
  const world = new World(new Rng(seed), WIND);
  const flag = world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
  const consort = world.addShip(new Ship(20, 0, Math.PI / 2, undefined, SailSet.Battle));
  return { world, flag, consort };
}

describe("CommandSystem — the order pipeline", () => {
  it("runs an order through all six stages and the captain carries it out", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);
    const ordered = Math.PI; // come round to run dead before the wind — reachable

    const order = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: ordered });
    expect(cmd.view()[0]?.stage).toBe(SignalStage.Hoist);

    step(world, cmd, 50);

    const report = cmd.reports.find((r) => r.orderId === order.id);
    expect(report?.outcome).toBe("complete");
    expect(Math.abs(wrapAngle(consort.heading - ordered))).toBeLessThan(0.1);

    const stages = cmd.events.filter((e) => e.orderId === order.id).map((e) => e.stage);
    expect(stages).toEqual([
      SignalStage.Hoist,
      SignalStage.EnRoute,
      SignalStage.Comprehend,
      SignalStage.Execute,
      SignalStage.Complete,
    ]);
  });

  it("does not move the helm until the order has been hoisted, read, and comprehended", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);
    const before = consort.targetHeading;

    cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: 0 });
    step(world, cmd, 0.5); // still inside tHoist
    expect(consort.targetHeading).toBe(before);

    step(world, cmd, 10); // well past hoist + receive + comprehend
    expect(consort.targetHeading).not.toBe(before);
  });

  it("acknowledges on its own timeline — the captain may already be acting", () => {
    // Long reception (and so a long ack round-trip) relative to comprehension, so
    // there is a real window where the ship is executing but the admiral does not
    // yet know his order landed.
    const ackCfg: SignalConfig = {
      tHoist: 0.5,
      baseLook: 3,
      rangePenaltyPerMetre: 0,
      signalRange: 600,
      baseComprehend: 0.5,
      baseMisread: 0,
      maxMisread: 0,
    };
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, ackCfg);
    const order = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: Math.PI });

    // t≈5s: received ~3.5, executing from ~4.0, but ack only returns at ~6.5.
    step(world, cmd, 5);
    let v = cmd.view().find((o) => o.id === order.id);
    expect(v?.stage).toBe(SignalStage.Execute);
    expect(v?.acknowledged).toBe(false);

    // t≈7.5s: the ack has now round-tripped; the order is still being carried out.
    step(world, cmd, 2.5);
    v = cmd.view().find((o) => o.id === order.id);
    expect(v?.stage).toBe(SignalStage.Execute);
    expect(v?.acknowledged).toBe(true);
  });

  it("supersedes the previous order in the same domain", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);

    const a = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: 0 });
    const b = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: Math.PI });

    expect(cmd.reports.find((r) => r.orderId === a.id)?.outcome).toBe("voided");
    expect(cmd.view().map((v) => v.id)).toEqual([b.id]);

    step(world, cmd, 50);
    expect(Math.abs(wrapAngle(consort.heading - Math.PI))).toBeLessThan(0.1);
  });

  it("lets a helm order and a sail order stand side by side (cross-domain)", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);

    const helm = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: 0 });
    const sail = cmd.issue(consort.id, { type: OrderType.SetSail, sailSet: SailSet.Full });

    expect(cmd.reports).toHaveLength(0);
    expect(cmd.view().map((v) => v.id).sort()).toEqual([helm.id, sail.id].sort());
  });

  it("holds an order out of signal range until it comes back within range", () => {
    const world = new World(new Rng(7), WIND);
    const flag = world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
    // Furled and far off — beyond signal range, so the flags can't be read.
    const consort = world.addShip(new Ship(5000, 0, Math.PI / 2, undefined, SailSet.Furled));
    const cmd = new CommandSystem(world, FAST);
    cmd.setFlagship(flag.id);
    const before = consort.targetHeading;

    const order = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: 0 });
    step(world, cmd, 20);
    expect(cmd.view().find((v) => v.id === order.id)?.stage).toBe(SignalStage.EnRoute);
    expect(cmd.reports).toHaveLength(0);
    expect(consort.targetHeading).toBe(before);

    // She closes to within range; now the hoist can be read and obeyed.
    consort.pose.x = 100;
    step(world, cmd, 10);
    expect(consort.targetHeading).not.toBe(before);
  });

  it("reports an order the ship can't obey instead of failing silently", () => {
    const world = new World(new Rng(2), WIND);
    world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
    // Head to wind, furled, in irons: she can't be put about.
    const consort = world.addShip(new Ship(20, 0, 0, undefined, SailSet.Furled));
    consort.inIrons = true;
    const cmd = new CommandSystem(world, FAST);

    const order = cmd.issue(consort.id, { type: OrderType.Tack });
    step(world, cmd, 10);
    expect(cmd.reports.find((r) => r.orderId === order.id)?.outcome).toBe("unexecutable");
  });

  it("carries out a plausible wrong order on a misread, and always reports it", () => {
    const alwaysMisread: SignalConfig = { ...FAST, baseMisread: 10, maxMisread: 1 };
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, alwaysMisread);

    const order = cmd.issue(consort.id, { type: OrderType.Tack });
    step(world, cmd, 15);

    const report = cmd.reports.find((r) => r.orderId === order.id);
    expect(report?.outcome).toBe("misread");
    expect(report?.detail).toContain("misread");
  });

  it("carries out a sail order and reports it complete", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);

    const order = cmd.issue(consort.id, { type: OrderType.SetSail, sailSet: SailSet.Full });
    step(world, cmd, 30);

    expect(cmd.reports.find((r) => r.orderId === order.id)?.outcome).toBe("complete");
    expect(consort.sailSet).toBe(SailSet.Full);
    expect(Math.abs(consort.trim - 1)).toBeLessThan(1e-2);
  });

  it("completes a hold-station order once the captain has it", () => {
    const { world, consort } = makeWorld();
    const cmd = new CommandSystem(world, FAST);

    const order = cmd.issue(consort.id, { type: OrderType.HoldStation });
    step(world, cmd, 10);
    expect(cmd.reports.find((r) => r.orderId === order.id)?.outcome).toBe("complete");
  });

  it("voids an order to a recipient that doesn't exist", () => {
    const { world } = makeWorld();
    const cmd = new CommandSystem(world, FAST);

    const order = cmd.issue(999, { type: OrderType.HoldStation });
    step(world, cmd, 5);
    expect(cmd.reports.find((r) => r.orderId === order.id)?.outcome).toBe("voided");
  });

  it("is deterministic: same seed + same orders gives the same outcome", () => {
    function run() {
      const world = new World(new Rng(0x5eed), WIND);
      world.addShip(new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle));
      const consort = world.addShip(new Ship(30, 0, Math.PI / 2, undefined, SailSet.Battle));
      const cmd = new CommandSystem(world, DEFAULT_SIGNALS);
      cmd.setCaptain(consort.id, RAW_CAPTAIN); // prone to misread — exercises the RNG
      cmd.issue(consort.id, { type: OrderType.SetSail, sailSet: SailSet.Full });
      cmd.issue(consort.id, { type: OrderType.Tack });
      step(world, cmd, 30);
      return { heading: consort.heading, surge: consort.surge, reports: cmd.reports };
    }
    const a = run();
    const b = run();
    expect(b.heading).toBe(a.heading);
    expect(b.surge).toBe(a.surge);
    expect(b.reports).toEqual(a.reports);
  });

  it("respects captain quality: a crack crew reads and obeys faster than a raw one", () => {
    function timeToExecute(captain: typeof CRACK_CAPTAIN | typeof RAW_CAPTAIN): number {
      const { world, consort } = makeWorld();
      const cmd = new CommandSystem(world, DEFAULT_SIGNALS);
      cmd.setCaptain(consort.id, captain);
      const order = cmd.issue(consort.id, { type: OrderType.SteerToHeading, heading: Math.PI });
      for (let t = 0; t < 60; t += DT) {
        cmd.tick(DT);
        world.tick(DT);
        const v = cmd.view().find((o) => o.id === order.id);
        if (v && (v.stage === SignalStage.Execute || v.stage === SignalStage.Complete)) return t;
      }
      return Infinity;
    }
    expect(timeToExecute(CRACK_CAPTAIN)).toBeLessThan(timeToExecute(RAW_CAPTAIN));
  });
});
