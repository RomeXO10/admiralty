/**
 * Sailing dynamics — the P1 behaviours that make the ship sail honestly:
 * the no-go zone, momentum, leeway, steerage-gated steering, tacking vs.
 * wearing, and missing stays into irons. All deterministic, three.js-free.
 */
import { describe, it, expect } from "vitest";
import { Ship } from "./ship";
import { SailSet } from "./shipClass";
import { trueWindAngle, signedWindAngle, type Wind } from "./wind";

const DT = 1 / 60;
const WIND: Wind = { fromDir: 0, speed: 7 }; // blows from +X
const deg = (d: number) => (d * Math.PI) / 180;

function run(ship: Ship, n: number, wind: Wind = WIND, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += DT;
    ship.step(DT, t, wind);
  }
  return t;
}

describe("no-go zone", () => {
  it("makes no headway pointed inside the no-go zone", () => {
    const ship = new Ship(0, 0, deg(30), undefined, SailSet.Full); // 30° < 60° nogo
    run(ship, 60);
    expect(ship.surge).toBeLessThan(0.05);
    expect(ship.inIrons).toBe(true);
  });

  it("makes good way once clear of the no-go zone (a reach)", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full); // beam reach
    run(ship, 300);
    expect(ship.surge).toBeGreaterThan(2);
    expect(ship.pose.z).toBeGreaterThan(0); // sailing toward +Z
    expect(ship.inIrons).toBe(false);
  });
});

describe("momentum", () => {
  it("gathers way gradually rather than instantly", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 1);
    const afterOneStep = ship.surge;
    const early = (run(ship, 59), ship.surge);
    const settled = (run(ship, 600), ship.surge);
    expect(afterOneStep).toBeLessThan(0.5);
    expect(early).toBeLessThan(settled);
  });

  it("carries way after the sails are furled, then loses it", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 600);
    const underway = ship.surge;
    expect(underway).toBeGreaterThan(2);
    ship.setSail(SailSet.Furled);
    // She doesn't stop dead — way is still on a second later (crew also need
    // time to hand the canvas, so trim eases off rather than vanishing).
    run(ship, 60);
    expect(ship.surge).toBeGreaterThan(1);
    // ...but with the canvas in and no drive she loses it all before long.
    run(ship, 1800);
    expect(ship.surge).toBeLessThan(0.2);
  });

  it("carries more canvas for more speed", () => {
    const battle = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Battle);
    const full = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(battle, 900);
    run(full, 900);
    expect(full.surge).toBeGreaterThan(battle.surge);
  });
});

describe("making and reducing sail", () => {
  it("works the trim toward the ordered set over time, not instantly", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Furled);
    expect(ship.trim).toBe(0);
    ship.setSail(SailSet.Full);
    run(ship, 1);
    expect(ship.trim).toBeGreaterThan(0);
    expect(ship.trim).toBeLessThan(0.1);
    // sailTrimTime is 8 s for the full range; halfway through ≈ half trim.
    run(ship, 239); // ~4 s total
    expect(ship.trim).toBeGreaterThan(0.4);
    expect(ship.trim).toBeLessThan(0.6);
  });
});

describe("leeway", () => {
  it("slips to leeward, across the heading", () => {
    // Beam reach heading +Z; wind from +X means leeward is −X.
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 120);
    expect(ship.velocity.z).toBeGreaterThan(0); // forward
    expect(ship.velocity.x).toBeLessThan(0); // drift to leeward (−X)
    expect(ship.pose.x).toBeLessThan(0);
  });
});

describe("steering", () => {
  it("answers the helm once she has steerage way", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 120); // build way
    ship.setHelm(Math.PI / 2 + 0.8);
    run(ship, 1000);
    const err = Math.abs(signedWindAngle(ship.heading, { fromDir: Math.PI / 2 + 0.8, speed: 0 }));
    expect(err).toBeLessThan(0.15);
  });

  it("has a dead helm without steerage way", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Furled);
    const h0 = ship.heading;
    ship.setHelm(Math.PI); // order a big turn
    run(ship, 120);
    expect(Math.abs(ship.heading - h0)).toBeLessThan(0.05);
  });
});

describe("tacking and wearing", () => {
  it("tacks through the wind to the other board", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full); // starboard beam
    run(ship, 600); // plenty of way on
    ship.tack(WIND);
    let minTwa = Math.PI;
    for (let i = 0; i < 800; i++) {
      run(ship, 1);
      minTwa = Math.min(minTwa, trueWindAngle(ship.heading, WIND));
    }
    // Came across to the other (port) board, settling near the mirrored beam
    // reach and still carrying good way.
    expect(signedWindAngle(ship.heading, WIND)).toBeLessThan(0); // port tack now
    const twaNow = trueWindAngle(ship.heading, WIND);
    expect(twaNow).toBeGreaterThan(deg(60));
    expect(twaNow).toBeLessThan(deg(120));
    expect(ship.surge).toBeGreaterThan(2);
    // A tack passes *through* the wind (TWA dips toward 0).
    expect(minTwa).toBeLessThan(deg(20));
  });

  it("wears the long way round, stern through the wind", () => {
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 600);
    ship.wear(WIND);
    let maxTwa = 0;
    for (let i = 0; i < 1500; i++) {
      run(ship, 1);
      maxTwa = Math.max(maxTwa, trueWindAngle(ship.heading, WIND));
    }
    // Ends up on the other (port) board, like a tack — but got there the long
    // way, passing through *downwind* (TWA swings up toward π).
    expect(signedWindAngle(ship.heading, WIND)).toBeLessThan(0);
    expect(maxTwa).toBeGreaterThan(deg(160));
  });

  it("misses stays into irons when tacking in light air, then falls off and recovers", () => {
    const light: Wind = { fromDir: 0, speed: 1.5 };
    const ship = new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    run(ship, 600, light); // creeps along, little way on
    expect(ship.surge).toBeLessThan(1.5);
    ship.tack(light);

    let sawIrons = false;
    for (let i = 0; i < 600; i++) {
      run(ship, 1, light);
      if (ship.inIrons) sawIrons = true;
    }
    expect(sawIrons).toBe(true);

    // Left to herself she falls off the wind and eventually draws again.
    run(ship, 2000, light);
    expect(ship.inIrons).toBe(false);
    expect(trueWindAngle(ship.heading, light)).toBeGreaterThanOrEqual(ship.shipClass.nogoAngle);
  });
});

describe("determinism", () => {
  it("reproduces an identical track from identical orders", () => {
    const make = () => new Ship(0, 0, Math.PI / 2, undefined, SailSet.Full);
    const a = make();
    const b = make();
    run(a, 200);
    run(b, 200);
    a.tack(WIND);
    b.tack(WIND);
    run(a, 400);
    run(b, 400);
    expect(a.pose).toEqual(b.pose);
    expect(a.heading).toBe(b.heading);
    expect(a.surge).toBe(b.surge);
    expect(a.velocity).toEqual(b.velocity);
  });
});
