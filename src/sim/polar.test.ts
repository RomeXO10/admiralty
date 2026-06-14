import { describe, it, expect } from "vitest";
import {
  drivePolar,
  SQUARE_POLAR,
  FORE_AFT_POLAR,
  type PolarPoint,
} from "./polar";

const deg = (d: number) => (d * Math.PI) / 180;

describe("drivePolar", () => {
  it("passes exactly through every control point of a table", () => {
    for (const table of [SQUARE_POLAR, FORE_AFT_POLAR]) {
      for (const pt of table as readonly PolarPoint[]) {
        expect(drivePolar(deg(pt.twaDeg), table)).toBeCloseTo(pt.drive, 10);
      }
    }
  });

  it("gives no drive in the no-go zone (head to wind)", () => {
    expect(drivePolar(deg(0), SQUARE_POLAR)).toBe(0);
    expect(drivePolar(deg(20), SQUARE_POLAR)).toBeLessThan(0.05);
  });

  it("peaks on a broad reach for a square rig (~130°)", () => {
    const peak = drivePolar(deg(130), SQUARE_POLAR);
    expect(peak).toBeCloseTo(1, 6);
    expect(peak).toBeGreaterThan(drivePolar(deg(90), SQUARE_POLAR));
    expect(peak).toBeGreaterThanOrEqual(drivePolar(deg(180), SQUARE_POLAR));
  });

  it("never returns outside [0, 1]", () => {
    for (let d = -360; d <= 360; d += 3) {
      const v = drivePolar(deg(d), SQUARE_POLAR);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is symmetric about the wind line (port = starboard)", () => {
    for (const d of [40, 75, 110, 150]) {
      expect(drivePolar(deg(d), SQUARE_POLAR)).toBeCloseTo(
        drivePolar(deg(-d), SQUARE_POLAR),
        10,
      );
      // ...and folds angles past 180° back down.
      expect(drivePolar(deg(360 - d), SQUARE_POLAR)).toBeCloseTo(
        drivePolar(deg(d), SQUARE_POLAR),
        10,
      );
    }
  });

  it("lets a fore-and-aft rig point higher than a square rig", () => {
    expect(drivePolar(deg(60), FORE_AFT_POLAR)).toBeGreaterThan(
      drivePolar(deg(60), SQUARE_POLAR),
    );
  });

  it("interpolates smoothly between knots (monotone up the close-hauled edge)", () => {
    let prev = -1;
    for (let d = 60; d <= 130; d += 5) {
      const v = drivePolar(deg(d), SQUARE_POLAR);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});
