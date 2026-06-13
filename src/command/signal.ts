/**
 * The signal-latency model — the numbers behind "you order, captains obey,
 * eventually and imperfectly" (see `docs/command-system.md` §2).
 *
 * Pure functions over a tunable {@link SignalConfig}: how long a hoist takes to
 * be read at a given range, how long the captain takes to comprehend it, the
 * chance he misreads it, and — when he does — what *plausible wrong* order he
 * carries out instead. Distance gating stands in for line-of-sight here; real
 * perception (fog, smoke, night) drops in at P5 behind {@link inSignalRange}.
 *
 * No sim integration and no three.js — just arithmetic and a seeded RNG.
 */
import { clamp, wrapAngle } from "@core/math";
import { SailSet } from "@sim/shipClass";
import type { Rng } from "@core/rng";
import { OrderType, type OrderBody } from "./order";

export interface SignalConfig {
  /** Fixed time (s) to bend on and raise the flags at the flagship. */
  tHoist: number;
  /** Base reception time (s) at lookout = 1 and zero range. */
  baseLook: number;
  /** Extra reception time (s) per metre of separation. */
  rangePenaltyPerMetre: number;
  /** Beyond this separation (m) the flags can't be read at all (LOS gate). */
  signalRange: number;
  /** Base comprehension time (s) at skill = 1. */
  baseComprehend: number;
  /** Base misread weight, added to the range fraction before scaling. */
  baseMisread: number;
  /** Hard cap on misread probability — even a green crew usually gets it right. */
  maxMisread: number;
}

/**
 * Tuned for a legible demo: a few seconds of hoist + reception + comprehension
 * so the signal delay is plainly visible, and a long enough `signalRange` to
 * cover a single squadron in open water.
 */
export const DEFAULT_SIGNALS: SignalConfig = {
  tHoist: 3,
  baseLook: 3,
  rangePenaltyPerMetre: 0.01,
  signalRange: 600,
  baseComprehend: 2.5,
  baseMisread: 0.06,
  maxMisread: 0.6,
};

/** Whether the flags are legible at this separation (the v1 line-of-sight gate). */
export function inSignalRange(cfg: SignalConfig, distance: number): boolean {
  return distance <= cfg.signalRange;
}

/**
 * Expected wait for the target's lookout to read the hoist: a base time scaled by
 * lookout quality, plus a penalty that grows with range. The same figure serves
 * for the acknowledgement's return trip (symmetric).
 */
export function receiveTime(cfg: SignalConfig, distance: number, lookout: number): number {
  return cfg.baseLook / lookout + distance * cfg.rangePenaltyPerMetre;
}

/** Time the captain takes to comprehend a received order; faster the higher his skill. */
export function comprehendTime(cfg: SignalConfig, skill: number): number {
  return cfg.baseComprehend / skill;
}

/**
 * Probability the captain misreads the order, in [0, maxMisread]. Rises with
 * order complexity and range (harder to make out distant flags), falls with
 * skill. Complexity gates it: a 0-complexity order is never misread.
 */
export function misreadChance(
  cfg: SignalConfig,
  complexity: number,
  distance: number,
  skill: number,
): number {
  const rangeFrac = clamp(distance / cfg.signalRange, 0, 1);
  const p = ((cfg.baseMisread + rangeFrac) * complexity) / skill;
  return clamp(p, 0, cfg.maxMisread);
}

/**
 * Turn an order into a *plausible wrong* one — what a captain actually does when
 * he misreads the flags. Never silent: the swap is telegraphed by a misread
 * report and visible in the ship's behaviour (`docs/command-system.md` §2).
 *
 * - Steer-to-heading: reads an adjacent bearing, off by 30–90° either way.
 * - Tack ↔ wear: the classic confusion of which way to put her about.
 * - Set sail: one step too much or too little canvas.
 * - Hold station: nothing plausible to get wrong, so it stands.
 */
export function corrupt(body: OrderBody, rng: Rng): OrderBody {
  switch (body.type) {
    case OrderType.SteerToHeading: {
      const sign = rng.next() < 0.5 ? -1 : 1;
      const err = ((30 + rng.next() * 60) * Math.PI) / 180;
      return { type: OrderType.SteerToHeading, heading: wrapAngle(body.heading + sign * err) };
    }
    case OrderType.Tack:
      return { type: OrderType.Wear };
    case OrderType.Wear:
      return { type: OrderType.Tack };
    case OrderType.SetSail: {
      const delta = rng.next() < 0.5 ? -1 : 1;
      const level = clamp(body.sailSet + delta, SailSet.Furled, SailSet.Full) as SailSet;
      return { type: OrderType.SetSail, sailSet: level };
    }
    case OrderType.HoldStation:
      return body;
  }
}
