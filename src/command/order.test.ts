import { describe, it, expect } from "vitest";
import { SailSet } from "@sim/shipClass";
import {
  complexityOf,
  describeBody,
  domainOf,
  OrderDomain,
  OrderType,
} from "./order";

describe("order metadata", () => {
  it("routes sail orders to the sail domain and everything else to the helm", () => {
    expect(domainOf(OrderType.SetSail)).toBe(OrderDomain.Sail);
    expect(domainOf(OrderType.SteerToHeading)).toBe(OrderDomain.Helm);
    expect(domainOf(OrderType.Tack)).toBe(OrderDomain.Helm);
    expect(domainOf(OrderType.Wear)).toBe(OrderDomain.Helm);
    expect(domainOf(OrderType.HoldStation)).toBe(OrderDomain.Helm);
  });

  it("gives every order type a complexity in [0, 1]", () => {
    for (const t of Object.values(OrderType)) {
      const c = complexityOf(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("rates a steer order more complex than holding station", () => {
    expect(complexityOf(OrderType.SteerToHeading)).toBeGreaterThan(
      complexityOf(OrderType.HoldStation),
    );
  });
});

describe("describeBody", () => {
  it("renders headings in whole degrees, wrapped to [0, 360)", () => {
    expect(describeBody({ type: OrderType.SteerToHeading, heading: 0 })).toBe("steer to 0°");
    expect(describeBody({ type: OrderType.SteerToHeading, heading: Math.PI / 2 })).toBe(
      "steer to 90°",
    );
    // -90° wraps to 270°.
    expect(describeBody({ type: OrderType.SteerToHeading, heading: -Math.PI / 2 })).toBe(
      "steer to 270°",
    );
  });

  it("names sail orders by their set", () => {
    expect(describeBody({ type: OrderType.SetSail, sailSet: SailSet.Full })).toBe(
      "set sail Full",
    );
  });

  it("describes the bare verbs", () => {
    expect(describeBody({ type: OrderType.Tack })).toBe("tack");
    expect(describeBody({ type: OrderType.Wear })).toBe("wear");
    expect(describeBody({ type: OrderType.HoldStation })).toBe("hold station");
  });
});
