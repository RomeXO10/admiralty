/**
 * Fixed-timestep game loop with a render/interpolation split.
 *
 * This is the hard architectural rule from DESIGN.md §5: the simulation
 * advances in fixed, deterministic steps, while rendering runs as fast as the
 * display allows and *interpolates* between the two most recent sim states. The
 * sim never sees wall-clock time, so it is reproducible from seed + inputs.
 *
 * Classic accumulator pattern (see Gaffer's "Fix Your Timestep"):
 *   - accumulate real elapsed time
 *   - while >= dt, step the sim once and consume dt
 *   - render with alpha = leftover / dt to blend previous→current
 */

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  update: (dt: number) => void;
  /**
   * Draw a frame. `alpha` in [0, 1) is how far we are between the previous and
   * current sim states — use it to interpolate for smooth motion.
   */
  render: (alpha: number) => void;
}

export interface LoopOptions {
  /** Simulation step in seconds. Default 1/60 (60 Hz). */
  dt?: number;
  /**
   * Cap on sim steps per frame. Prevents a "spiral of death" if a frame stalls
   * (e.g. tab backgrounded): we drop time rather than try to catch up forever.
   */
  maxStepsPerFrame?: number;
}

export class GameLoop {
  readonly dt: number;
  private readonly maxSteps: number;
  private readonly cb: LoopCallbacks;

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  /** Total simulated time in seconds (advances only in fixed steps). */
  simTime = 0;
  /** Number of fixed steps taken since start. */
  tick = 0;

  constructor(callbacks: LoopCallbacks, options: LoopOptions = {}) {
    this.cb = callbacks;
    this.dt = options.dt ?? 1 / 60;
    this.maxSteps = options.maxStepsPerFrame ?? 5;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      this.step(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Advance one animation frame given the current high-res timestamp (ms). */
  private step(now: number): void {
    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Guard against absurd dt (alt-tab, debugger pause).
    if (frameTime > 0.25) frameTime = 0.25;
    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= this.dt) {
      this.cb.update(this.dt);
      this.accumulator -= this.dt;
      this.simTime += this.dt;
      this.tick += 1;
      if (++steps >= this.maxSteps) {
        // Bleed off remaining backlog so we don't spiral.
        this.accumulator = 0;
        break;
      }
    }

    const alpha = this.accumulator / this.dt;
    this.cb.render(alpha);
  }
}
