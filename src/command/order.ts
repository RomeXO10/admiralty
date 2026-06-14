/**
 * Order vocabulary — the formal language the admiral speaks to captains.
 *
 * P2 ships the movement subset (see `docs/command-system.md` §3). An {@link Order}
 * is a recipient + a typed {@link OrderBody} + metadata the pipeline reads:
 * its **domain** (helm or sail — new orders supersede older ones in the same
 * domain) and its **complexity** (drives comprehension time and the chance a
 * captain misreads the flags). Pure data; no three.js, no sim state.
 */
import { SailSet } from "@sim/shipClass";

/** Stable identity of a ship in the world (see `World.addShip`). */
export type ShipId = number;

/** The movement orders available in P2. Combat/squadron orders arrive in P3/P4. */
export enum OrderType {
  SteerToHeading = "SteerToHeading",
  Tack = "Tack",
  Wear = "Wear",
  SetSail = "SetSail",
  HoldStation = "HoldStation",
}

/**
 * Conflict domain. A captain can hold one order per domain at a time, so a fresh
 * helm order supersedes the previous helm order but leaves a sail order standing
 * (and vice-versa) — see `docs/command-system.md` §3.
 */
export enum OrderDomain {
  Helm = "helm",
  Sail = "sail",
}

/** A typed order body: the verb plus whatever parameters it carries. */
export type OrderBody =
  | { type: OrderType.SteerToHeading; heading: number }
  | { type: OrderType.Tack }
  | { type: OrderType.Wear }
  | { type: OrderType.SetSail; sailSet: SailSet }
  | { type: OrderType.HoldStation };

/** An order in flight, with the metadata the signal pipeline reads. */
export interface Order {
  readonly id: number;
  readonly recipient: ShipId;
  /** Sim time (s) the admiral composed it. */
  readonly issuedAt: number;
  readonly body: OrderBody;
  readonly domain: OrderDomain;
  /** 0..1: how easy the order is to misread / how long to comprehend. */
  readonly complexity: number;
}

/** Which conflict domain an order type belongs to. */
export function domainOf(type: OrderType): OrderDomain {
  return type === OrderType.SetSail ? OrderDomain.Sail : OrderDomain.Helm;
}

/**
 * How complex an order is to read and obey, in [0, 1]. A bare "tack" is simpler
 * than "steer two-seven-zero"; "hold station" is near-trivial. These feed
 * comprehension time and misread chance (see `signal.ts`).
 */
export function complexityOf(type: OrderType): number {
  switch (type) {
    case OrderType.SteerToHeading:
      return 0.5;
    case OrderType.Tack:
    case OrderType.Wear:
      return 0.45;
    case OrderType.SetSail:
      return 0.35;
    case OrderType.HoldStation:
      return 0.15;
  }
}

const RAD2DEG = 180 / Math.PI;

/** Human-readable summary of an order body, for reports and the HUD. */
export function describeBody(body: OrderBody): string {
  switch (body.type) {
    case OrderType.SteerToHeading: {
      const deg = (((body.heading * RAD2DEG) % 360) + 360) % 360;
      return `steer to ${Math.round(deg)}°`;
    }
    case OrderType.Tack:
      return "tack";
    case OrderType.Wear:
      return "wear";
    case OrderType.SetSail:
      return `set sail ${SailSet[body.sailSet]}`;
    case OrderType.HoldStation:
      return "hold station";
  }
}
