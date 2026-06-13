import { describe, it, expect } from "vitest";
import { Rng } from "@core/rng";
import { wrapAngle } from "@core/math";
import { SailSet } from "@sim/shipClass";
import { OrderType, type OrderBody } from "./order";
import {
  comprehendTime,
  corrupt,
  DEFAULT_SIGNALS,
  inSignalRange,
  misreadChance,
  receiveTime,
  type SignalConfig,
} from "./signal";

const CFG = DEFAULT_SIGNALS;

describe("inSignalRange", () => {
  it("gates legibility at the configured range", () => {
    expect(inSignalRange(CFG, 0)).toBe(true);
    expect(inSignalRange(CFG, CFG.signalRange)).toBe(true);
    expect(inSignalRange(CFG, CFG.signalRange + 1)).toBe(false);
  });
});

describe("receiveTime", () => {
  it("grows with range and shrinks with lookout quality", () => {
    expect(receiveTime(CFG, 100, 1)).toBeGreaterThan(receiveTime(CFG, 0, 1));
    expect(receiveTime(CFG, 100, 1.5)).toBeLessThan(receiveTime(CFG, 100, 1));
  });
});

describe("comprehendTime", () => {
  it("shrinks with skill", () => {
    expect(comprehendTime(CFG, 1.5)).toBeLessThan(comprehendTime(CFG, 1));
    expect(comprehendTime(CFG, 0.5)).toBeGreaterThan(comprehendTime(CFG, 1));
  });
});

describe("misreadChance", () => {
  it("never misreads a zero-complexity order", () => {
    expect(misreadChance(CFG, 0, CFG.signalRange, 1)).toBe(0);
  });

  it("rises with range and falls with skill, bounded by the cap", () => {
    const near = misreadChance(CFG, 0.5, 50, 1);
    const far = misreadChance(CFG, 0.5, CFG.signalRange, 1);
    expect(far).toBeGreaterThan(near);

    const green = misreadChance(CFG, 0.5, 300, 0.6);
    const crack = misreadChance(CFG, 0.5, 300, 1.4);
    expect(green).toBeGreaterThan(crack);

    // A deliberately punishing config still can't exceed the cap.
    const harsh: SignalConfig = { ...CFG, baseMisread: 5 };
    expect(misreadChance(harsh, 1, harsh.signalRange, 0.1)).toBe(harsh.maxMisread);
  });

  it("stays within [0, 1] across a sweep", () => {
    for (let d = 0; d <= CFG.signalRange; d += 50) {
      for (const skill of [0.5, 1, 1.5]) {
        const p = misreadChance(CFG, 0.5, d, skill);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("corrupt — plausible wrong orders", () => {
  const rng = () => new Rng(0x1234);

  it("swaps tack and wear", () => {
    expect(corrupt({ type: OrderType.Tack }, rng()).type).toBe(OrderType.Wear);
    expect(corrupt({ type: OrderType.Wear }, rng()).type).toBe(OrderType.Tack);
  });

  it("reads a steer order off by 30–90°, still a valid heading", () => {
    const body: OrderBody = { type: OrderType.SteerToHeading, heading: 1 };
    const got = corrupt(body, rng());
    expect(got.type).toBe(OrderType.SteerToHeading);
    if (got.type === OrderType.SteerToHeading) {
      const err = Math.abs(wrapAngle(got.heading - body.heading));
      expect(err).toBeGreaterThanOrEqual((30 * Math.PI) / 180 - 1e-9);
      expect(err).toBeLessThanOrEqual((90 * Math.PI) / 180 + 1e-9);
      // Stored wrapped into (-π, π].
      expect(got.heading).toBeGreaterThan(-Math.PI - 1e-9);
      expect(got.heading).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it("misreads a sail order by one step, clamped to the valid range", () => {
    // Furled can only be misread upward; Full only downward.
    for (let i = 0; i < 20; i++) {
      const r = new Rng(i);
      const lo = corrupt({ type: OrderType.SetSail, sailSet: SailSet.Furled }, r);
      if (lo.type === OrderType.SetSail) {
        expect(lo.sailSet).toBeGreaterThanOrEqual(SailSet.Furled);
        expect(lo.sailSet).toBeLessThanOrEqual(SailSet.Full);
      }
      const hi = corrupt({ type: OrderType.SetSail, sailSet: SailSet.Full }, r);
      if (hi.type === OrderType.SetSail) {
        expect(hi.sailSet).toBeLessThanOrEqual(SailSet.Full);
      }
    }
  });

  it("leaves hold-station untouched (nothing plausible to get wrong)", () => {
    const body: OrderBody = { type: OrderType.HoldStation };
    expect(corrupt(body, rng())).toBe(body);
  });
});
