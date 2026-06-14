import { describe, it, expect } from "vitest";
import { DamageState, DEFAULT_DAMAGE, type DamageConfig } from "./damage";

const CFG: DamageConfig = { ...DEFAULT_DAMAGE, complement: 200 };

function fresh(overrides: Partial<DamageConfig> = {}): DamageState {
  return new DamageState({ ...CFG, ...overrides });
}

describe("DamageState — a sound hull", () => {
  it("starts whole, fully crewed, and at full morale", () => {
    const d = fresh();
    expect(d.hull).toBe(1);
    expect(d.rigging).toBe(1);
    expect(d.rudder).toBe(1);
    expect(d.crew).toBe(200);
    expect(d.morale).toBe(1);
    expect(d.sinking).toBe(false);
  });

  it("reports unit modifiers at full health (so sailing is unchanged)", () => {
    const d = fresh();
    expect(d.speedFactor).toBe(1);
    expect(d.turnFactor).toBe(1);
    expect(d.steerFactor).toBe(1);
    expect(d.crewFactor).toBe(1);
    expect(d.crewRatio).toBe(1);
  });
});

describe("DamageState — holing & flooding", () => {
  it("holes the hull and clamps integrity at zero", () => {
    const d = fresh();
    d.holeHull(0.3);
    expect(d.hull).toBeCloseTo(0.7, 10);
    d.holeHull(5);
    expect(d.hull).toBe(0);
  });

  it("sinks when standing flood beats the pumps and reserve buoyancy", () => {
    const d = fresh({ reserveBuoyancy: 10, pumpRate: 4 });
    d.holeHull(0.2, 6); // 6 t/s in, 4 t/s pumped out → +2 t/s
    for (let i = 0; i < 60 * 4; i++) d.step(1 / 60); // ~4 s → ~8 t (not yet)
    expect(d.sinking).toBe(false);
    for (let i = 0; i < 60 * 2; i++) d.step(1 / 60); // ~6 s total → >10 t
    expect(d.sinking).toBe(true);
  });

  it("keeps a hull dry when the pumps out-pace minor flooding", () => {
    const d = fresh({ reserveBuoyancy: 10, pumpRate: 4 });
    d.holeHull(0.1, 2); // pumps (4) exceed inflow (2)
    for (let i = 0; i < 60 * 20; i++) d.step(1 / 60);
    expect(d.water).toBe(0);
    expect(d.sinking).toBe(false);
  });

  it("pumps weaken as the crew that works them is killed", () => {
    const d = fresh({ pumpRate: 4 });
    expect(d.pumpRate).toBeCloseTo(4, 10);
    d.loseCrew(100); // half the crew gone
    expect(d.pumpRate).toBeCloseTo(2, 10);
  });
});

describe("DamageState — masts & rigging", () => {
  it("weights the main mast most heavily in the mast factor", () => {
    const foreGone = fresh();
    foreGone.damageMast("fore", 1);
    const mainGone = fresh();
    mainGone.damageMast("main", 1);
    expect(mainGone.mastFactor).toBeLessThan(foreGone.mastFactor);
    expect(foreGone.mastFactor).toBeCloseTo(0.75, 10);
    expect(mainGone.mastFactor).toBeCloseTo(0.5, 10);
  });

  it("shocks morale the instant a mast goes by the board", () => {
    const d = fresh();
    d.damageMast("main", 0.5);
    expect(d.morale).toBe(1); // standing, just wounded
    d.damageMast("main", 1); // crosses to zero
    expect(d.morale).toBeCloseTo(1 - CFG.mastFallShock, 10);
  });

  it("cuts speed through rigging and standing masts together", () => {
    const d = fresh();
    d.cutRigging(0.5);
    expect(d.speedFactor).toBeCloseTo(0.5, 10);
    d.damageMast("main", 1); // mastFactor → 0.5
    expect(d.speedFactor).toBeCloseTo(0.25, 10);
  });

  it("bleeds rudder authority through the steer factor", () => {
    const d = fresh();
    d.damageRudder(0.6);
    expect(d.steerFactor).toBeCloseTo(0.4, 10);
  });
});

describe("DamageState — crew & morale", () => {
  it("erodes morale in proportion to casualties", () => {
    const d = fresh();
    d.loseCrew(20); // 10% of complement
    expect(d.crewRatio).toBeCloseTo(0.9, 10);
    expect(d.morale).toBeCloseTo(1 - 0.1 * CFG.moralePerCrewFraction, 10);
  });

  it("floors the crew factor so a skeleton crew still works, slowly", () => {
    const d = fresh({ minCrewFactor: 0.25 });
    d.loseCrew(200);
    expect(d.crewRatio).toBe(0);
    expect(d.crewFactor).toBe(0.25);
  });

  it("never drives any condition below zero or above one", () => {
    const d = fresh();
    d.holeHull(99, 0);
    d.cutRigging(99);
    d.damageRudder(99);
    d.loseCrew(9999);
    d.shock(99);
    for (const v of [d.hull, d.rigging, d.rudder, d.morale, d.crewRatio, d.mastFactor]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
