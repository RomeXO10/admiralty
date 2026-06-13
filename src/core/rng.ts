/**
 * Seeded, deterministic pseudo-random number generator.
 *
 * The whole simulation must be reproducible from a seed + order log (see
 * DESIGN.md §5). Everything in `sim/` that needs randomness draws from one of
 * these — never from `Math.random()`, which is non-deterministic.
 *
 * Implementation: mulberry32. Small, fast, good enough statistical quality for
 * a game, and trivially serializable (a single 32-bit state word).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to an unsigned 32-bit integer so behaviour is identical regardless
    // of how the seed was produced.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [min, max). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max));
  }

  /** Snapshot the internal state, e.g. for replay/serialization. */
  getState(): number {
    return this.state >>> 0;
  }

  /** Restore a previously snapshotted state. */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}
