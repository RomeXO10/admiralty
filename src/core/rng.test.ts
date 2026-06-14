import { describe, it, expect } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic: same seed yields the same sequence", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() stays within [0, 1)", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("range() stays within [min, max)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });

  it("int() returns integers within [min, max)", () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(0, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    // Over many draws we expect every bucket 0..5 to appear.
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("snapshots and restores state for replay", () => {
    const rng = new Rng(42);
    // Burn a few draws, then snapshot.
    rng.next();
    rng.next();
    const snapshot = rng.getState();
    const afterSnapshot = Array.from({ length: 10 }, () => rng.next());

    // A fresh Rng restored to the snapshot reproduces the same continuation.
    const restored = new Rng(0);
    restored.setState(snapshot);
    const replay = Array.from({ length: 10 }, () => restored.next());
    expect(replay).toEqual(afterSnapshot);
  });

  it("getState() always returns an unsigned 32-bit integer", () => {
    const rng = new Rng(-1);
    for (let i = 0; i < 50; i++) {
      rng.next();
      const s = rng.getState();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("coerces the seed to unsigned 32-bit (negative seed == its unsigned form)", () => {
    const a = new Rng(-1);
    const b = new Rng(0xffffffff);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});
