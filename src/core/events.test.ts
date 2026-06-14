import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./events";

// A `type` (not `interface`) so it satisfies the bus's `Record<string, unknown>`
// constraint — interfaces don't get an implicit index signature.
type TestEvents = {
  shipStruck: { shipId: number };
  orderIssued: { text: string };
};

describe("EventBus", () => {
  it("delivers an emitted payload to a registered listener", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("shipStruck", fn);
    bus.emit("shipStruck", { shipId: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ shipId: 7 });
  });

  it("delivers to every listener of the same type", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("shipStruck", a);
    bus.on("shipStruck", b);
    bus.emit("shipStruck", { shipId: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("isolates listeners by event type", () => {
    const bus = new EventBus<TestEvents>();
    const struck = vi.fn();
    const order = vi.fn();
    bus.on("shipStruck", struck);
    bus.on("orderIssued", order);
    bus.emit("orderIssued", { text: "tack" });
    expect(order).toHaveBeenCalledOnce();
    expect(struck).not.toHaveBeenCalled();
  });

  it("stops delivering after the returned unsubscribe is called", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    const off = bus.on("shipStruck", fn);
    bus.emit("shipStruck", { shipId: 1 });
    off();
    bus.emit("shipStruck", { shipId: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ shipId: 1 });
  });

  it("unsubscribing one listener leaves the others", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on("shipStruck", a);
    bus.on("shipStruck", b);
    offA();
    bus.emit("shipStruck", { shipId: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("emitting a type with no listeners is a no-op", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("shipStruck", { shipId: 1 })).not.toThrow();
  });
});
