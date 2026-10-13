import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalTickWakeup } from "../../src/skirmish/LocalTickWakeup";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function fixture(advance: () => void) {
  const messages: number[] = [];
  const port1 = { onmessage: null as ((event: MessageEvent<number>) => void) | null };
  const wakeup = new LocalTickWakeup(advance, { port1, port2: { postMessage: token => { messages.push(token); } } });
  return { wakeup, messages, deliver: () => port1.onmessage!(new MessageEvent("message", { data: messages.shift()! })) };
}
describe("local coordinator wakeups", () => {
  it("yields once per overdue tick without scheduling a zero timer", () => {
    vi.useFakeTimers();
    let count = 0;
    const f = fixture(() => { count++; f.wakeup.schedule(0); });
    f.wakeup.schedule(0);
    expect(count).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    f.deliver();
    expect(count).toBe(1);
    expect(f.messages).toHaveLength(1);
    f.deliver();
    expect(count).toBe(2);
    f.wakeup.cancel();
    f.deliver();
    expect(count).toBe(2);
  });
  it("ignores stale queued work after a reset and fires only the replacement timer", async () => {
    vi.useFakeTimers();
    const advance = vi.fn(), f = fixture(advance);
    f.wakeup.schedule(0);
    f.wakeup.schedule(50);
    f.deliver();
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(advance).toHaveBeenCalledTimes(1);
    f.wakeup.schedule(50);
    f.wakeup.cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
