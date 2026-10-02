import { describe, expect, it, vi } from "vitest";
import { PublicationQueue } from "../../src/skirmish/multiplayer/application/PublicationQueue";

describe("bounded ordered snapshot publication", () => {
  it("does not capture or move the delta cursor at capacity and publishes in order", async () => {
    const finish: ((value: number) => void)[] = [], published: number[][] = [];
    const queue = new PublicationQueue<number, number>(value => new Promise(resolve => finish[value] = resolve),
      (tick, value) => published.push([tick, value]), error => { throw error; });
    expect(queue.offer(10, () => 0)).toBe(true); expect(queue.offer(11, () => 1)).toBe(true);
    const skipped = vi.fn(() => 2);
    expect(queue.offer(12, skipped)).toBe(false); expect(skipped).not.toHaveBeenCalled();
    expect(queue.pending).toBe(2); expect(queue.skipped).toBe(1);
    finish[1](101); await Promise.resolve(); expect(published).toEqual([]);
    finish[0](100); await queue.flush();
    expect(published).toEqual([[10, 100], [11, 101]]); expect(queue.pending).toBe(0);
    expect(queue.offer(13, () => 2)).toBe(true); finish[2](102); await queue.flush();
    expect(published[2]).toEqual([13, 102]);
  });
  it("fences encoding failure, frees retained slots and does not publish later work", async () => {
    const failure = new Error("encoder unavailable"), publish = vi.fn(), failed = vi.fn();
    const queue = new PublicationQueue<number, number>(async value => { if (!value) throw failure; return value; }, publish, failed);
    queue.offer(1, () => 0); queue.offer(2, () => 1);
    await expect(queue.flush()).rejects.toThrow("encoder unavailable");
    expect(queue.pending).toBe(0); expect(failed).toHaveBeenCalledExactlyOnceWith(failure); expect(publish).not.toHaveBeenCalled();
    expect(() => queue.offer(3, () => 2)).toThrow("encoder unavailable");
  });
});
