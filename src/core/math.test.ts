import { describe, it, expect } from "vitest";
import { TAU, clamp, lerp, wrapAngle, lerpAngle } from "./math";

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below the minimum", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("clamps above the maximum", () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });
  it("returns the bounds at the edges", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("lerp", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(lerp(2, 8, 0)).toBe(2);
    expect(lerp(2, 8, 1)).toBe(8);
  });
  it("interpolates the midpoint", () => {
    expect(lerp(2, 8, 0.5)).toBe(5);
  });
  it("does not clamp t (extrapolates)", () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe("wrapAngle", () => {
  it("leaves angles already in range untouched", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it("wraps into the half-open interval [-PI, PI)", () => {
    // +PI and -PI both normalize to the lower bound -PI.
    expect(wrapAngle(Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI);
  });

  it("wraps angles beyond a full turn", () => {
    expect(wrapAngle(TAU)).toBeCloseTo(0);
    expect(wrapAngle(TAU + Math.PI / 4)).toBeCloseTo(Math.PI / 4);
    expect(wrapAngle(-TAU - Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });

  it("always returns a value within [-PI, PI)", () => {
    for (let a = -20; a <= 20; a += 0.137) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThan(Math.PI);
    }
  });
});

describe("lerpAngle", () => {
  it("returns the endpoints at t=0 and t=1 (mod wrapping)", () => {
    expect(lerpAngle(0.3, 1.2, 0)).toBeCloseTo(0.3);
    expect(wrapAngle(lerpAngle(0.3, 1.2, 1) - 1.2)).toBeCloseTo(0);
  });

  it("takes the short way around the wrap boundary", () => {
    // From just above -PI to just below +PI, the short arc crosses -PI, not 0.
    const a = -Math.PI + 0.1;
    const b = Math.PI - 0.1;
    const mid = lerpAngle(a, b, 0.5);
    // Midpoint should sit near +/-PI (the boundary), not near 0.
    expect(Math.abs(wrapAngle(mid))).toBeGreaterThan(Math.PI - 0.2);
  });

  it("interpolates the short arc through zero", () => {
    expect(lerpAngle(-0.4, 0.4, 0.5)).toBeCloseTo(0);
  });

  it("treats a tiny negative step as negative, not nearly a full turn", () => {
    // 0 -> (TAU - 0.2) is really a -0.2 step; halfway is -0.1.
    expect(lerpAngle(0, TAU - 0.2, 0.5)).toBeCloseTo(-0.1);
  });
});
