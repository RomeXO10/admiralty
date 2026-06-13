/**
 * The command layer — orders in, captains obeying, eventually and imperfectly.
 *
 * This is the deterministic heart of P2 (see `docs/command-system.md`). The
 * admiral {@link issue}s orders; each runs the six-stage pipeline
 *
 *   COMPOSE → HOIST → RECEIVE → ACKNOWLEDGE → COMPREHEND → EXECUTE
 *
 * as time is advanced by {@link tick}. Key fidelity points:
 *
 * - **Latency is real.** The helm does not move until a hoist has gone up, been
 *   read at range, and comprehended. Nothing teleports.
 * - **Reception is gated.** Out of signal range (the v1 stand-in for line of
 *   sight) the flag simply isn't read; the order waits.
 * - **Acknowledge is belief, not act.** The captain begins to comprehend the
 *   moment he reads the flag; the *acknowledgement* travels back to the flagship
 *   in parallel, so for a while the admiral doesn't yet know his order landed —
 *   the order may even be executing before he sees it acknowledged.
 * - **Misreads are plausible and telegraphed.** A misread executes a wrong-but-
 *   sensible order and always raises a report; state is never silently corrupted.
 * - **Supersede per domain.** A fresh helm order voids the previous helm order;
 *   a sail order standing alongside it is untouched.
 *
 * Execution hands off to the sailing model (`sim/`): the command layer calls the
 * ship's order interface and watches the physics carry the maneuver out. Pure
 * and three.js-free; deterministic from the world's seed + the order log.
 */
import { wrapAngle } from "@core/math";
import type { Ship } from "@sim/ship";
import type { World } from "@sim/world";
import { SAIL_TRIM } from "@sim/shipClass";
import {
  complexityOf,
  describeBody,
  domainOf,
  OrderType,
  type Order,
  type OrderBody,
  type ShipId,
} from "./order";
import { STEADY_CAPTAIN, type CaptainProfile } from "./captain";
import {
  comprehendTime,
  corrupt,
  DEFAULT_SIGNALS,
  inSignalRange,
  misreadChance,
  receiveTime,
  type SignalConfig,
} from "./signal";

/** The truth-stages an order moves through (what the ship is *actually* doing). */
export enum SignalStage {
  /** Flags being bent on and raised at the flagship. */
  Hoist = "Hoist",
  /** Raised; awaiting reception by the target (range/LOS gated). */
  EnRoute = "EnRoute",
  /** Read; the captain is working out the meaning. */
  Comprehend = "Comprehend",
  /** Crew + physics carrying the order out. */
  Execute = "Execute",
  Complete = "Complete",
  Voided = "Voided",
}

/** How an order ended — feeds the after-action log and the admiral's UI. */
export type OrderOutcome = "complete" | "misread" | "unexecutable" | "voided";

/** A stage transition, for UI overlays and the after-action timeline. */
export interface SignalEvent {
  readonly orderId: number;
  readonly recipient: ShipId;
  readonly stage: SignalStage;
  readonly atTime: number;
}

/** The fate of an order once it leaves the pipeline. */
export interface OrderReport {
  readonly orderId: number;
  readonly recipient: ShipId;
  readonly outcome: OrderOutcome;
  readonly detail: string;
  readonly atTime: number;
}

/** A read-only snapshot of an in-flight order, for the HUD / tactical plot. */
export interface OrderView {
  readonly id: number;
  readonly recipient: ShipId;
  readonly type: OrderType;
  readonly stage: SignalStage;
  /** True once the acknowledgement has returned — the admiral knows it landed. */
  readonly acknowledged: boolean;
  readonly misread: boolean;
}

/** Heading error (rad) under which a steer order is considered carried out. */
const EXEC_HEADING_TOL = 0.05;
/** Trim error under which a sail-set order is considered carried out. */
const EXEC_TRIM_TOL = 1e-3;

/** One order making its way through the pipeline. */
class Pipeline {
  stage: SignalStage = SignalStage.Hoist;
  /** Completion time of the current *timed* stage (Hoist, Comprehend). */
  stageEndsAt: number;
  /** Remaining reading time once LOS holds; null until first computed in range. */
  receiveRemaining: number | null = null;
  /** When the acknowledgement returns to the flagship; null until received. */
  ackReturnsAt: number | null = null;
  /** Belief: has the ack round-tripped yet? */
  acknowledged = false;
  /** The body actually carried out (may be a misread corruption of the order). */
  executed: OrderBody | null = null;
  misread = false;

  constructor(
    readonly order: Order,
    hoistEndsAt: number,
  ) {
    this.stageEndsAt = hoistEndsAt;
  }
}

export class CommandSystem {
  /** Command-layer clock (s), advanced in lockstep with the world by `tick`. */
  private time = 0;
  private nextOrderId = 1;
  private flagshipId: ShipId;

  private readonly captains = new Map<ShipId, CaptainProfile>();
  /** At most one live order per `recipient:domain` — the supersede rule. */
  private readonly active = new Map<string, Pipeline>();

  /** Stage-transition log; grows over the battle, drives UI and after-action. */
  readonly events: SignalEvent[] = [];
  /** Completed/voided/misread/unexecutable outcomes. */
  readonly reports: OrderReport[] = [];

  constructor(
    private readonly world: World,
    private readonly cfg: SignalConfig = DEFAULT_SIGNALS,
  ) {
    // The first ship added is the flagship (the admiral's own deck) by default.
    this.flagshipId = world.ships[0]?.id ?? 0;
  }

  /** Designate which ship the admiral signals from (range is measured to it). */
  setFlagship(id: ShipId): void {
    this.flagshipId = id;
  }

  /** Assign a captain to a ship; unassigned ships sail under {@link STEADY_CAPTAIN}. */
  setCaptain(id: ShipId, profile: CaptainProfile): void {
    this.captains.set(id, profile);
  }

  /**
   * COMPOSE + HOIST: register a fresh order and begin hoisting the signal. A new
   * order supersedes any live order to the same recipient in the same domain.
   */
  issue(recipient: ShipId, body: OrderBody): Order {
    const domain = domainOf(body.type);
    const order: Order = {
      id: this.nextOrderId++,
      recipient,
      issuedAt: this.time,
      body,
      domain,
      complexity: complexityOf(body.type),
    };

    const key = `${recipient}:${domain}`;
    const prev = this.active.get(key);
    if (prev) {
      this.finish(prev, "voided", `superseded by a fresh ${domain} order`);
    }

    const pipeline = new Pipeline(order, this.time + this.cfg.tHoist);
    this.active.set(key, pipeline);
    this.emit(pipeline);
    return order;
  }

  /** Advance every live order by `dt` seconds and let executions drive the sim. */
  tick(dt: number): void {
    this.time += dt;
    for (const [key, pipeline] of this.active) {
      this.advance(pipeline, dt);
      if (pipeline.stage === SignalStage.Complete || pipeline.stage === SignalStage.Voided) {
        this.active.delete(key);
      }
    }
  }

  /** Snapshot of all live orders for the HUD / tactical plot. */
  view(): OrderView[] {
    return [...this.active.values()].map((p) => ({
      id: p.order.id,
      recipient: p.order.recipient,
      type: p.order.body.type,
      stage: p.stage,
      acknowledged: p.acknowledged,
      misread: p.misread,
    }));
  }

  // --- Pipeline internals ---

  private advance(pipeline: Pipeline, dt: number): void {
    const recipient = this.shipOf(pipeline.order.recipient);
    if (!recipient) {
      this.finish(pipeline, "voided", "recipient is gone");
      return;
    }

    switch (pipeline.stage) {
      case SignalStage.Hoist:
        if (this.time >= pipeline.stageEndsAt) this.toEnRoute(pipeline);
        break;
      case SignalStage.EnRoute:
        this.advanceReception(pipeline, recipient, dt);
        break;
      case SignalStage.Comprehend:
        if (this.time >= pipeline.stageEndsAt) this.toExecute(pipeline, recipient);
        break;
      case SignalStage.Execute:
        this.advanceExecution(pipeline, recipient);
        break;
    }

    // ACKNOWLEDGE updates the admiral's *belief*, on its own timeline — the
    // captain may already be acting while the ack is still on its way back.
    if (
      pipeline.ackReturnsAt !== null &&
      !pipeline.acknowledged &&
      this.time >= pipeline.ackReturnsAt
    ) {
      pipeline.acknowledged = true;
    }
  }

  private toEnRoute(pipeline: Pipeline): void {
    pipeline.stage = SignalStage.EnRoute;
    pipeline.receiveRemaining = null; // computed once LOS first holds
    this.emit(pipeline);
  }

  /** RECEIVE: read the hoist, but only while it's legible (in range / LOS). */
  private advanceReception(pipeline: Pipeline, recipient: Ship, dt: number): void {
    const distance = this.distanceToFlagship(recipient);
    if (!inSignalRange(this.cfg, distance)) {
      // Can't make out the flags — the order waits, and the reading restarts
      // from whatever range she finally raises it at.
      pipeline.receiveRemaining = null;
      return;
    }

    const captain = this.captainOf(pipeline.order.recipient);
    if (pipeline.receiveRemaining === null) {
      pipeline.receiveRemaining = receiveTime(this.cfg, distance, captain.lookout);
    }
    pipeline.receiveRemaining -= dt;
    if (pipeline.receiveRemaining > 0) return;

    // Read at last. The captain starts comprehending now; the acknowledgement
    // begins its symmetric trip back to the flagship in parallel.
    pipeline.ackReturnsAt = this.time + receiveTime(this.cfg, distance, captain.lookout);
    pipeline.stage = SignalStage.Comprehend;
    pipeline.stageEndsAt = this.time + comprehendTime(this.cfg, captain.skill);
    this.emit(pipeline);
  }

  /** COMPREHEND → EXECUTE: resolve any misread, then hand the order to the sim. */
  private toExecute(pipeline: Pipeline, recipient: Ship): void {
    const captain = this.captainOf(pipeline.order.recipient);
    const distance = this.distanceToFlagship(recipient);
    const pMisread = misreadChance(
      this.cfg,
      pipeline.order.complexity,
      distance,
      captain.skill,
    );

    let body = pipeline.order.body;
    if (this.world.rng.next() < pMisread) {
      body = corrupt(body, this.world.rng);
      pipeline.misread = body !== pipeline.order.body;
    }
    pipeline.executed = body;

    // An order the ship physically can't obey right now returns a report rather
    // than failing silently — e.g. she can't be put about while in irons.
    if ((body.type === OrderType.Tack || body.type === OrderType.Wear) && recipient.inIrons) {
      this.finish(pipeline, "unexecutable", `cannot ${describeBody(body)} — in irons`);
      return;
    }

    this.applyToShip(recipient, body);
    pipeline.stage = SignalStage.Execute;
    this.emit(pipeline);
  }

  /** EXECUTE: hand the resolved order to the ship's helm / rig. */
  private applyToShip(ship: Ship, body: OrderBody): void {
    switch (body.type) {
      case OrderType.SteerToHeading:
        ship.setHelm(body.heading);
        break;
      case OrderType.Tack:
        ship.tack(this.world.wind);
        break;
      case OrderType.Wear:
        ship.wear(this.world.wind);
        break;
      case OrderType.SetSail:
        ship.setSail(body.sailSet);
        break;
      case OrderType.HoldStation:
        // Steady as she goes: hold the current course (formation-keeping is P4).
        ship.setHelm(ship.heading);
        break;
    }
  }

  /** Watch the physics finish the maneuver, then report the outcome. */
  private advanceExecution(pipeline: Pipeline, recipient: Ship): void {
    const body = pipeline.executed!;
    let done = false;
    let detail = describeBody(body);

    switch (body.type) {
      case OrderType.SteerToHeading:
        done =
          recipient.maneuver === "none" &&
          Math.abs(wrapAngle(recipient.heading - body.heading)) < EXEC_HEADING_TOL;
        break;
      case OrderType.HoldStation:
        done = true; // the helm has the order; she holds her course
        break;
      case OrderType.Tack:
      case OrderType.Wear:
        done = recipient.maneuver === "none";
        if (done && recipient.inIrons) detail = `${detail} — missed stays, in irons`;
        break;
      case OrderType.SetSail:
        done = Math.abs(recipient.trim - SAIL_TRIM[body.sailSet]) < EXEC_TRIM_TOL;
        break;
    }

    if (!done) return;
    if (pipeline.misread) {
      this.finish(pipeline, "misread", `misread — ${detail}`);
    } else {
      this.finish(pipeline, "complete", detail);
    }
  }

  private finish(pipeline: Pipeline, outcome: OrderOutcome, detail: string): void {
    pipeline.stage = outcome === "voided" ? SignalStage.Voided : SignalStage.Complete;
    this.reports.push({
      orderId: pipeline.order.id,
      recipient: pipeline.order.recipient,
      outcome,
      detail,
      atTime: this.time,
    });
    this.emit(pipeline);
  }

  private emit(pipeline: Pipeline): void {
    this.events.push({
      orderId: pipeline.order.id,
      recipient: pipeline.order.recipient,
      stage: pipeline.stage,
      atTime: this.time,
    });
  }

  // --- Lookups ---

  private captainOf(id: ShipId): CaptainProfile {
    return this.captains.get(id) ?? STEADY_CAPTAIN;
  }

  private shipOf(id: ShipId): Ship | undefined {
    return this.world.ships.find((s) => s.id === id);
  }

  private distanceToFlagship(ship: Ship): number {
    const flag = this.shipOf(this.flagshipId);
    if (!flag) return 0;
    return Math.hypot(ship.pose.x - flag.pose.x, ship.pose.z - flag.pose.z);
  }
}
