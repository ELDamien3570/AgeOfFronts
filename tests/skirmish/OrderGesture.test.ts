import { describe, expect, it, vi } from "vitest";
import { OrderGesture } from "../../src/skirmish/client/OrderGesture";
describe("charge gesture dispatch", () => {
  it("sends the ordinary order at once and upgrades a double click to one charge", () => {
    const gesture = new OrderGesture(),
      single = vi.fn(),
      charge = vi.fn();
    gesture.submit({ time: 0, x: 10, y: 10, context: "1:5,6", single }, charge);
    // No 350 ms hold: the move leaves on the first click.
    expect(single).toHaveBeenCalledTimes(1);
    gesture.submit({ time: 200, x: 11, y: 11, context: "1:5,6", single }, charge);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledTimes(1);
    // A third click is a fresh order, never a second charge.
    gesture.submit({ time: 300, x: 11, y: 11, context: "1:5,6", single }, charge);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledTimes(2);
  });
  it("dispatches ordinary and queued moves without inventing a charge", () => {
    const gesture = new OrderGesture(),
      single = vi.fn();
    gesture.submit({ time: 0, x: 0, y: 0, context: "1:5", single });
    gesture.submit({ time: 1, x: 0, y: 0, context: "1:5", single });
    expect(single).toHaveBeenCalledTimes(2);
  });
  it("charges only for the same selection, nearby, within the interval", () => {
    const gesture = new OrderGesture(),
      single = vi.fn(),
      charge = vi.fn();
    gesture.submit({ time: 0, x: 0, y: 0, context: "1:5", single }, charge);
    gesture.submit({ time: 100, x: 0, y: 0, context: "1:6", single }, charge);
    gesture.submit({ time: 200, x: 20, y: 0, context: "1:6", single }, charge);
    gesture.submit({ time: 900, x: 20, y: 0, context: "1:6", single }, charge);
    expect(charge).not.toHaveBeenCalled();
    expect(single).toHaveBeenCalledTimes(4);
    gesture.cancel();
    gesture.submit({ time: 950, x: 20, y: 0, context: "1:6", single }, charge);
    expect(charge).not.toHaveBeenCalled();
  });
});
