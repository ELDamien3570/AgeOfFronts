import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import { domainRouteKey } from "../../src/skirmish/domain/DomainRoutePorts";
import { SeaTradeRoutes } from "../../src/skirmish/domain/SeaTradeRoutes";
import type { LaneDemand, SeaLaneTask } from "../../src/skirmish/domain/SeaTradeTypes";

function fixture(limits = { records: 16, packedCells: 64, stagingCells: 64, recoveryCells: 8, recoveryRecords: 2 }) {
  const map = new GameMapImpl(12, 4, new Uint8Array(48), 48), water = new WaterPaths(map, false);
  let tick = 0, accept = true;
  const active = new Map<string, SeaLaneTask>(), calls: SeaLaneTask[] = [];
  const service = new SeaTradeRoutes(map, water, () => ({
    request(task) { calls.push(task); if (!accept) return false; active.set(domainRouteKey(task), task); return true; },
    cancel(task) { active.delete(domainRouteKey(task)); }, has: key => active.has(key),
  }), () => tick, () => 100, limits);
  const demand = (key: string, start = 1, goal = 9, owner = 1): LaneDemand => ({ subscriberKey: key,
    start, goal, owner, kind: "departure", firstDemandTick: tick,
    holder: { type: "actor-demand", actorId: owner, shipmentId: 0 } });
  const complete = (path = [1, 2, 3, 4, 5, 6, 7, 8, 9]) => {
    const task = [...active.values()][0]; expect(task).toBeDefined();
    active.delete(domainRouteKey(task)); service.completedRoute(task, "complete", path); return task;
  };
  return { service, calls, active, demand, complete, setTick: (n: number) => { tick = n; }, refuse: () => { accept = false; }, allow: () => { accept = true; } };
}

describe("sea lane registry", () => {
  it("shares one accepted request across owners and both orientations without poll replacement", () => {
    const f = fixture();
    f.service.acquire(f.demand("one")); f.service.acquire(f.demand("two", 9, 1, 2));
    f.service.stepManagement(8);
    for (let i = 0; i < 100; i++) f.service.acquire(f.demand("one"));
    expect(f.calls).toHaveLength(1);
    f.service.release("one"); f.complete(); f.service.stepManagement(1);
    expect(f.service.stepCopies(3)).toBe(3); expect(f.service.peek(1, 9)).toBeUndefined();
    expect(f.service.stepCopies(100)).toBe(6);
    const use = f.service.peek(9, 1)!;
    expect(Array.from({ length: 9 }, (_, i) => f.service.tile(use, i))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(f.service.usage).toMatchObject({ records: 1, packedCells: 9, subscriptions: 1 });
  });
  it("keeps refusal ages, ignores stale callbacks, and never treats occupancy as unreachable", () => {
    const f = fixture(); f.refuse(); f.service.acquire(f.demand("one")); f.service.stepManagement(1);
    const first = f.calls[0]; expect(f.service.checkpoint().lanes[0]).toMatchObject({ firstDemandTick: 0, state: "queued", nextAttemptTick: 1 });
    f.setTick(1); f.allow(); f.service.stepManagement(3); expect(f.calls).toHaveLength(2);
    f.service.completedRoute(first, "complete", [1, 9]);
    expect(f.service.checkpoint().lanes[0].state).toBe("requested"); expect(f.service.diagnostics.stale).toBe(1);
    f.complete(); f.service.stepManagement(1); f.service.stepCopies(100);
    expect(f.service.peek(1, 9)).toBeDefined();
  });
  it("cold-restores partial packing with exactly the next copy and work state", () => {
    const f = fixture(); f.service.acquire(f.demand("one")); f.service.stepManagement(1); f.complete();
    f.service.stepManagement(1); f.service.stepCopies(4);
    const cold = fixture(); cold.service.restore(f.service.checkpoint());
    expect(cold.service.checkpoint()).toEqual(f.service.checkpoint());
    for (let i = 0; i < 5; i++) { expect(cold.service.stepCopies(1)).toBe(f.service.stepCopies(1)); expect(cold.service.checkpoint()).toEqual(f.service.checkpoint()); }
    const invalid = f.service.checkpoint(); invalid.lanes[0].references++;
    expect(() => fixture().service.restore(invalid)).toThrow("reference");
  });
  it("releases idempotently, evicts soft retention, and protects active pins", () => {
    const f = fixture({ records: 16, packedCells: 12, stagingCells: 64, recoveryCells: 0, recoveryRecords: 0 });
    f.service.acquire(f.demand("one")); f.service.stepManagement(1); f.complete(); f.service.stepManagement(1); f.service.stepCopies(100);
    f.service.retain("source", f.service.peek(1, 9)!); f.service.release("one"); f.service.release("one");
    f.service.acquire({ ...f.demand("two", 13, 21, 2), kind: "salvage" }); f.service.stepManagement(1); f.complete([13, 14, 15, 16, 17, 18, 19, 20, 21]);
    f.service.stepManagement(4); f.service.stepCopies(100);
    expect(f.service.peek(1, 9)).toBeUndefined(); expect(f.service.peek(13, 21)).toBeDefined();
    expect(f.service.usage).toMatchObject({ packedCells: 9, subscriptions: 1 });
    expect(f.service.checkpoint().sourceRetention).toEqual([]);
  });
  it("retires an abandoned request once and fences reacquisition behind acknowledgement", () => {
    const f = fixture(); f.service.acquire(f.demand("one")); f.service.stepManagement(1);
    const old = f.calls[0]; f.service.release("one"); f.service.stepManagement(1);
    f.service.acquire(f.demand("two")); f.service.stepManagement(1);
    f.setTick(1); f.service.stepManagement(4);
    expect(f.calls).toHaveLength(2);
    f.service.completedRoute(old, "superseded", []);
    expect(f.service.checkpoint().lanes[0].state).toBe("requested");
  });
  it("fails explicitly on a lost request or invalid connected geometry", () => {
    const f = fixture(); f.service.acquire(f.demand("one")); f.service.stepManagement(1); f.active.clear();
    expect(() => f.service.stepManagement(2)).toThrow("Lost sea route");
    const g = fixture(); g.service.acquire(g.demand("one")); g.service.stepManagement(1);
    g.complete([1, 3, 9]); g.service.stepManagement(1);
    expect(() => g.service.stepCopies(10)).toThrow("geometry");
  });
  it("keeps heap/queue metadata bounded through repeated acquisition and release", () => {
    const f = fixture();
    for (let i = 0; i < 10_000; i++) { f.service.acquire(f.demand("one")); f.service.release("one"); }
    expect(f.service.usage).toMatchObject({ records: 1, subscriptions: 0, queued: 0 });
    f.service.stepManagement(10); expect(f.service.usage.records).toBe(0);
  });
});
