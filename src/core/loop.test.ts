import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GameLoop } from "./loop";

/**
 * The loop normally rides `requestAnimationFrame` + `performance.now`, neither
 * of which exists (meaningfully) under the node test environment. We stub both
 * so we can drive frames by hand with controlled timestamps and assert the
 * fixed-timestep accumulator behaves deterministically.
 */
describe("GameLoop", () => {
  let nowMs: number;
  let frameCb: ((t: number) => void) | null;

  beforeEach(() => {
    nowMs = 0;
    frameCb = null;
    vi.stubGlobal("performance", { now: () => nowMs });
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      frameCb = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Advance the fake wall clock by `ms` and run exactly one frame. */
  function advanceFrame(ms: number): void {
    nowMs += ms;
    frameCb!(nowMs);
  }

  it("steps the sim a fixed number of times for the elapsed wall time", () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ update, render }, { dt: 0.01, maxStepsPerFrame: 100 });
    loop.start();

    advanceFrame(55); // 0.055s elapsed / 0.01 dt => 5 whole steps, 0.005 left
    expect(update).toHaveBeenCalledTimes(5);
    expect(update).toHaveBeenLastCalledWith(0.01);
    expect(loop.tick).toBe(5);
    expect(loop.simTime).toBeCloseTo(0.05, 10);
  });

  it("passes a render alpha equal to the leftover fraction of dt", () => {
    const render = vi.fn();
    const loop = new GameLoop({ update: vi.fn(), render }, { dt: 0.01, maxStepsPerFrame: 100 });
    loop.start();

    advanceFrame(55); // leftover 0.005 of 0.01 => alpha 0.5
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.lastCall![0]).toBeCloseTo(0.5, 10);
  });

  it("carries leftover time across frames", () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() }, { dt: 0.01, maxStepsPerFrame: 100 });
    loop.start();

    advanceFrame(7); // 0.007 < 0.01 => no step yet
    expect(update).toHaveBeenCalledTimes(0);
    advanceFrame(7); // 0.014 total => one step, 0.004 left
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("caps steps per frame to avoid the spiral of death", () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ update, render }, { dt: 0.01, maxStepsPerFrame: 3 });
    loop.start();

    advanceFrame(100); // would be 10 steps; capped at 3, backlog bled off
    expect(update).toHaveBeenCalledTimes(3);
    expect(loop.tick).toBe(3);
    // Accumulator was reset, so alpha collapses to 0.
    expect(render.mock.lastCall![0]).toBeCloseTo(0, 10);
  });

  it("clamps an absurd frame delta (alt-tab / debugger pause) to 0.25s", () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() }, { dt: 0.01, maxStepsPerFrame: 1000 });
    loop.start();

    advanceFrame(5000); // 5s elapsed, clamped to 0.25s => ~25 steps, not 500
    // ~0.25s / 0.01 dt; floating-point residue may shave the last step.
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(24);
    expect(update.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it("defaults to a 60 Hz step", () => {
    const loop = new GameLoop({ update: vi.fn(), render: vi.fn() });
    expect(loop.dt).toBeCloseTo(1 / 60, 10);
  });

  it("does not advance after stop()", () => {
    const update = vi.fn();
    const loop = new GameLoop({ update, render: vi.fn() }, { dt: 0.01, maxStepsPerFrame: 100 });
    loop.start();
    advanceFrame(20); // 2 steps
    const ticksBefore = loop.tick;
    loop.stop();
    advanceFrame(50); // frame fires but loop is stopped
    expect(loop.tick).toBe(ticksBefore);
  });

  it("ignores a redundant start() while already running", () => {
    const loop = new GameLoop({ update: vi.fn(), render: vi.fn() }, { dt: 0.01 });
    loop.start();
    const firstCb = frameCb;
    loop.start(); // should be a no-op, not re-register a fresh frame
    expect(frameCb).toBe(firstCb);
  });
});
