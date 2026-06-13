import { describe, it, expect } from "vitest";
import {
  signedWindAngle,
  trueWindAngle,
  windDriveFactor,
  pointOfSail,
  REFERENCE_WIND_SPEED,
  type Wind,
} from "./wind";

const wind = (fromDir: number, speed = 7): Wind => ({ fromDir, speed });

describe("true-wind angles", () => {
  it("is 0 when the bow points straight into the wind (head to wind)", () => {
    expect(trueWindAngle(1.2, wind(1.2))).toBeCloseTo(0, 10);
  });

  it("is π when the wind is dead astern (running)", () => {
    expect(trueWindAngle(0, wind(Math.PI))).toBeCloseTo(Math.PI, 10);
  });

  it("is π/2 on a beam reach", () => {
    expect(trueWindAngle(Math.PI / 2, wind(0))).toBeCloseTo(Math.PI / 2, 10);
  });

  it("signs the angle by which board the ship is on and wraps shortest-arc", () => {
    expect(signedWindAngle(0.3, wind(0))).toBeCloseTo(0.3, 10);
    expect(signedWindAngle(-0.3, wind(0))).toBeCloseTo(-0.3, 10);
    // Crossing the ±π boundary takes the short way, not the long way.
    expect(Math.abs(signedWindAngle(-Math.PI + 0.1, wind(Math.PI - 0.1)))).toBeCloseTo(
      0.2,
      10,
    );
  });

  it("magnitude never exceeds π", () => {
    for (let h = -10; h <= 10; h += 0.13) {
      expect(trueWindAngle(h, wind(0.7))).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe("windDriveFactor", () => {
  it("is 1 at the reference wind speed", () => {
    expect(windDriveFactor(REFERENCE_WIND_SPEED)).toBeCloseTo(1, 10);
  });
  it("scales down in light air and is zero in a calm", () => {
    expect(windDriveFactor(0)).toBe(0);
    expect(windDriveFactor(REFERENCE_WIND_SPEED / 2)).toBeCloseTo(0.5, 10);
  });
  it("saturates rather than growing without bound in a gale", () => {
    expect(windDriveFactor(100)).toBeLessThanOrEqual(1.25 + 1e-9);
  });
});

describe("pointOfSail", () => {
  const nogo = Math.PI / 3; // 60°
  it("labels the in-irons override regardless of angle", () => {
    expect(pointOfSail(Math.PI, nogo, true)).toBe("In irons");
  });
  it("calls everything inside the no-go zone 'No-go'", () => {
    expect(pointOfSail((40 * Math.PI) / 180, nogo, false)).toBe("No-go");
  });
  it("names the points of sail across the range", () => {
    expect(pointOfSail((70 * Math.PI) / 180, nogo, false)).toBe("Close-hauled");
    expect(pointOfSail((90 * Math.PI) / 180, nogo, false)).toBe("Beam reach");
    expect(pointOfSail((130 * Math.PI) / 180, nogo, false)).toBe("Broad reach");
    expect(pointOfSail((175 * Math.PI) / 180, nogo, false)).toBe("Running");
  });
});
