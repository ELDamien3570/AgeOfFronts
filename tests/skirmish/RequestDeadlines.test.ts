import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREPARE_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  RequestDeadlines,
  requestTimeoutMs,
} from "../../src/skirmish/multiplayer/infrastructure/RequestDeadlines";

describe("executor request deadlines (R2-P1, R2-P5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives prepare its own limit and leaves every other request at 30 s", () => {
    expect(PREPARE_REQUEST_TIMEOUT_MS).toBe(150_000);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(requestTimeoutMs("prepare")).toBe(150_000);
    for (const type of ["initialize", "select-spawn", "spawn-state", "start", "advance", "baseline"] as const)
      expect(requestTimeoutMs(type)).toBe(30_000);
  });

  it("runs only the head request's timer, so a queued select does not time out behind a long prepare", () => {
    const expired: string[] = [];
    const deadlines = new RequestDeadlines<string>((_id, name) => expired.push(name));
    deadlines.enqueue(1, requestTimeoutMs("prepare"), "prepare");
    deadlines.enqueue(2, requestTimeoutMs("select-spawn"), "select");
    // Far beyond the select's own 30 s, but the prepare is still within its 150 s.
    vi.advanceTimersByTime(100_000);
    expect(expired).toEqual([]);
    deadlines.settle(1);
    // The select's 30 s starts now, not at enqueue.
    vi.advanceTimersByTime(29_999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(expired).toEqual(["select"]);
  });

  it("expires the head at its own limit and does not fire after it settles", () => {
    const expired: string[] = [];
    const deadlines = new RequestDeadlines<string>((_id, name) => expired.push(name));
    deadlines.enqueue(1, 150_000, "prepare");
    vi.advanceTimersByTime(149_999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(expired).toEqual(["prepare"]);
    deadlines.enqueue(2, 30_000, "a");
    deadlines.settle(2);
    deadlines.clear();
    vi.advanceTimersByTime(1_000_000);
    expect(expired).toEqual(["prepare"]);
    expect(deadlines.size).toBe(0);
  });

  it("starts a settled head's successor even when settle arrives for a non-head id first", () => {
    const expired: string[] = [];
    const deadlines = new RequestDeadlines<string>((_id, name) => expired.push(name));
    deadlines.enqueue(1, 10, "one");
    deadlines.enqueue(2, 10, "two");
    deadlines.enqueue(3, 10, "three");
    deadlines.settle(2);
    deadlines.settle(1);
    vi.advanceTimersByTime(11);
    expect(expired).toEqual(["three"]);
  });
});
