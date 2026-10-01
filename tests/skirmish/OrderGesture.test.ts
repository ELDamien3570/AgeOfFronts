import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderGesture } from "../../src/skirmish/client/OrderGesture";
afterEach(() => vi.useRealTimers());
describe("charge gesture dispatch", () => {
  it("dispatches one charge and no preliminary ordinary orders for a double click", () => {
    vi.useFakeTimers();
    const gesture = new OrderGesture(),
      single = vi.fn(),
      charge = vi.fn();
    gesture.submit({ time: 0, x: 10, y: 10, context: "1:5,6", single }, charge);
    vi.advanceTimersByTime(200);
    gesture.submit(
      { time: 200, x: 11, y: 11, context: "1:5,6", single },
      charge,
    );
    vi.advanceTimersByTime(1000);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });
  it("dispatches ordinary and queued moves without inventing a charge", () => {
    vi.useFakeTimers();
    const gesture = new OrderGesture(),
      single = vi.fn();
    gesture.submit({ time: 0, x: 0, y: 0, context: "1:5", single });
    expect(single).toHaveBeenCalledTimes(1);
    gesture.submit({ time: 1, x: 0, y: 0, context: "1:5", single }, vi.fn());
    vi.advanceTimersByTime(349);
    expect(single).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledTimes(2);
  });
  it("cancels stale selection or match intents and requires the same nearby target gesture", () => {
    vi.useFakeTimers();
    const gesture = new OrderGesture(),
      first = vi.fn(),
      second = vi.fn(),
      charge = vi.fn();
    gesture.submit(
      { time: 0, x: 0, y: 0, context: "1:5", single: first },
      charge,
    );
    gesture.submit(
      { time: 100, x: 0, y: 0, context: "1:6", single: second },
      charge,
    );
    vi.advanceTimersByTime(350);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(charge).not.toHaveBeenCalled();
    gesture.submit(
      { time: 500, x: 0, y: 0, context: "1:6", single: first },
      charge,
    );
    gesture.submit(
      { time: 600, x: 20, y: 0, context: "1:6", single: second },
      charge,
    );
    expect(first).toHaveBeenCalledTimes(1);
    gesture.cancel();
    vi.advanceTimersByTime(1000);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
