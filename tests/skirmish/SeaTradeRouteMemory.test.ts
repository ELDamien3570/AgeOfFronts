import { describe, expect, it } from "vitest";
import { SeaWorkHeap, SeaWorkQueue } from "../../src/skirmish/domain/SeaTradeWork";
import { seaFleet } from "./SeaTradeFixture";
describe("sea route memory and work indexes", () => {
  it("keeps indexed heaps equal to an independent sorted set under churn", () => {
    const values = new Map<number, number>(), active = new Set<number>();
    const heap = new SeaWorkHeap<number>((a, b) => values.get(a)! < values.get(b)! || values.get(a) === values.get(b) && a < b);
    for (let i = 0; i < 10000; i++) {
      const key = i * 17 % 73; values.set(key, (i * 53) % 101); active.add(key); heap.update(key);
      if (i % 3 === 0) { const key = i * 19 % 73; active.delete(key); heap.remove(key); }
      const expected = [...active].sort((a, b) => values.get(a)! - values.get(b)! || a - b)[0];
      expect(heap.first()).toBe(expected); expect(heap.size).toBe(active.size);
      if (i % 7 === 0) { expect(heap.pop()).toBe(expected); active.delete(expected); }
    }
  });
  it("restores logical FIFO ordering after removals and repeated additions", () => {
    const queue = new SeaWorkQueue<number>(); queue.add(1); queue.add(2); queue.add(3); queue.remove(2); queue.add(1); queue.add(2);
    expect(queue.values()).toEqual([1, 3, 2]); expect(queue.pop()).toBe(1); queue.remove(2); expect(queue.pop()).toBe(3); expect(queue.pop()).toBeUndefined();
  });
  it("stores one route payload for a recurrent fleet and reconstructs every hard pin", () => {
    const f = seaFleet(); f.step(550);
    const saved = f.trade.seaTrade!.checkpoint();
    const counts = new Map<number, number>();
    for (const sub of saved.routes.subscriptions) counts.set(sub.laneId, (counts.get(sub.laneId) ?? 0) + 1);
    for (const lane of saved.routes.lanes) expect(lane.references).toBe(counts.get(lane.id) ?? 0);
    expect(saved.routes.lanes.filter(lane => lane.state === "ready")).toHaveLength(1);
    expect(f.trade.actors.every(actor => actor.path.length === 0)).toBe(true);
    expect(saved.routes.sourceRetention.every(([, rows]) => rows.length <= 2)).toBe(true);
  });
});
