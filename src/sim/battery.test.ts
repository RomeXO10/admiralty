import { describe, it, expect } from "vitest";
import {
  Battery,
  BatterySide,
  FireMode,
  ShotType,
  bears,
  relativeBearing,
  BEAM_ARC_HALF,
} from "./battery";

const HALF_PI = Math.PI / 2;

describe("relativeBearing — where a point lies relative to the bow", () => {
  it("reads 0 dead ahead and ±π/2 on the beams (heading 0, forward +X)", () => {
    expect(relativeBearing(0, 0, 0, 10, 0)).toBeCloseTo(0, 10); // ahead
    expect(relativeBearing(0, 0, 0, 0, 10)).toBeCloseTo(HALF_PI, 10); // starboard (+Z)
    expect(relativeBearing(0, 0, 0, 0, -10)).toBeCloseTo(-HALF_PI, 10); // port (−Z)
    expect(Math.abs(relativeBearing(0, 0, 0, -10, 0))).toBeCloseTo(Math.PI, 10); // astern
  });

  it("rotates with the hull's heading", () => {
    // Heading +π/2: forward is +Z, so a point at +Z is dead ahead.
    expect(relativeBearing(HALF_PI, 0, 0, 0, 10)).toBeCloseTo(0, 10);
  });
});

describe("bears — which battery covers a bearing", () => {
  it("bears a broadside abeam on its own side only", () => {
    expect(bears(BatterySide.Starboard, HALF_PI)).toBe(true);
    expect(bears(BatterySide.Starboard, -HALF_PI)).toBe(false);
    expect(bears(BatterySide.Starboard, 0)).toBe(false); // ahead, no broadside bears
    expect(bears(BatterySide.Port, -HALF_PI)).toBe(true);
    expect(bears(BatterySide.Port, HALF_PI)).toBe(false);
  });

  it("respects the arc half-width at the edges", () => {
    expect(bears(BatterySide.Starboard, HALF_PI + BEAM_ARC_HALF - 0.01)).toBe(true);
    expect(bears(BatterySide.Starboard, HALF_PI + BEAM_ARC_HALF + 0.01)).toBe(false);
  });

  it("gives the chasers narrow fore/aft arcs", () => {
    expect(bears(BatterySide.BowChaser, 0)).toBe(true);
    expect(bears(BatterySide.BowChaser, HALF_PI)).toBe(false);
    expect(bears(BatterySide.SternChaser, Math.PI)).toBe(true);
    expect(bears(BatterySide.SternChaser, 0)).toBe(false);
  });
});

describe("Battery — loading and damage", () => {
  it("starts loaded with the requested shot and mode", () => {
    const b = new Battery({
      side: BatterySide.Port,
      guns: 12,
      gunWeight: 18,
      baseReload: 20,
      shotType: ShotType.Chain,
      fireMode: FireMode.Rolling,
    });
    expect(b.ready).toBe(true);
    expect(b.shotType).toBe(ShotType.Chain);
    expect(b.fireMode).toBe(FireMode.Rolling);
    expect(b.effectiveGuns).toBe(12);
  });

  it("defaults to round shot fired in broadside", () => {
    const b = new Battery({ side: BatterySide.Port, guns: 8, gunWeight: 12, baseReload: 20 });
    expect(b.shotType).toBe(ShotType.Round);
    expect(b.fireMode).toBe(FireMode.Broadside);
  });

  it("goes unready on firing and reloads over time", () => {
    const b = new Battery({ side: BatterySide.Port, guns: 8, gunWeight: 12, baseReload: 20 });
    b.fire();
    expect(b.ready).toBe(false);
    for (let i = 0; i < 60 * 19; i++) b.stepReload(1 / 60, 1);
    expect(b.ready).toBe(false);
    for (let i = 0; i < 60 * 2; i++) b.stepReload(1 / 60, 1);
    expect(b.ready).toBe(true);
  });

  it("reloads slower with a short-handed crew", () => {
    const full = new Battery({ side: BatterySide.Port, guns: 8, gunWeight: 12, baseReload: 20 });
    const short = new Battery({ side: BatterySide.Port, guns: 8, gunWeight: 12, baseReload: 20 });
    full.fire();
    short.fire();
    for (let i = 0; i < 60 * 20; i++) {
      full.stepReload(1 / 60, 1);
      short.stepReload(1 / 60, 0.5);
    }
    expect(full.ready).toBe(true);
    expect(short.ready).toBe(false); // half the hands → roughly twice the time
  });

  it("loses guns to dismounting and caps at the battery size", () => {
    const b = new Battery({ side: BatterySide.Port, guns: 6, gunWeight: 18, baseReload: 20 });
    b.dismount(2);
    expect(b.effectiveGuns).toBe(4);
    b.dismount(10);
    expect(b.effectiveGuns).toBe(0);
    expect(b.ready).toBe(false); // no guns left to fire
  });
});
