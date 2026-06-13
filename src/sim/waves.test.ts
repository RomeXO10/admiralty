import { describe, it, expect } from "vitest";
import { WAVE_COMPONENTS, waveHeight, waveNormal } from "./waves";

describe("WAVE_COMPONENTS", () => {
  it("normalizes each wave's direction to a unit vector", () => {
    for (const w of WAVE_COMPONENTS) {
      expect(Math.hypot(w.nx, w.nz)).toBeCloseTo(1, 10);
    }
  });

  it("derives wavenumber and angular frequency from length and speed", () => {
    for (const w of WAVE_COMPONENTS) {
      expect(w.k).toBeCloseTo((Math.PI * 2) / w.length, 10);
      expect(w.omega).toBeCloseTo(w.k * w.speed, 10);
    }
  });
});

describe("waveHeight", () => {
  it("is deterministic for the same position and time", () => {
    expect(waveHeight(3, -7, 2.5)).toBe(waveHeight(3, -7, 2.5));
  });

  it("never exceeds the summed amplitude of all components", () => {
    const maxAmp = WAVE_COMPONENTS.reduce((s, w) => s + w.amplitude, 0);
    for (let t = 0; t < 5; t += 0.25) {
      for (let x = -50; x <= 50; x += 13) {
        for (let z = -50; z <= 50; z += 13) {
          expect(Math.abs(waveHeight(x, z, t))).toBeLessThanOrEqual(maxAmp + 1e-9);
        }
      }
    }
  });

  it("evolves over time (the field is not static)", () => {
    expect(waveHeight(0, 0, 0)).not.toBeCloseTo(waveHeight(0, 0, 1.0), 5);
  });
});

describe("waveNormal", () => {
  it("returns a unit-length vector", () => {
    for (let t = 0; t < 3; t += 0.4) {
      for (let x = -20; x <= 20; x += 7) {
        const n = waveNormal(x, x * 0.5, t);
        expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10);
      }
    }
  });

  it("always points upward (positive Y)", () => {
    for (let t = 0; t < 3; t += 0.3) {
      for (let x = -20; x <= 20; x += 5) {
        for (let z = -20; z <= 20; z += 5) {
          expect(waveNormal(x, z, t).y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic for the same position and time", () => {
    const a = waveNormal(4, 9, 1.2);
    const b = waveNormal(4, 9, 1.2);
    expect(a).toEqual(b);
  });
});
