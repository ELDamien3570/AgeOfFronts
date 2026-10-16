import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { PLANNER_PARTITION, RoutePlanner } from "../../src/skirmish/RoutePlanner";

interface Context { playerId: number; human: boolean; committed?: boolean; caller?: "admission" | "navigation" }

function fixture() {
  const map = new GameMapImpl(80, 80, new Uint8Array(6400).fill(133), 6400);
  const make = () => new RoutePlanner<Context>(new LandPaths(map, false), new WaterPaths(map, false), {
    identity: r => ({ playerId: r.context.playerId, caller: r.context.caller ?? "admission" }),
    priority: r => r.context.human,
    committed: r => !!r.context.committed,
    valid: () => true, obstacleRevision: () => "0", blocked: () => undefined, completed: () => {},
  });
  const planner = make();
  const requestOn = (target: RoutePlanner<Context>, key: string, context: Context) => target.request({
    key, start: 0, goal: 6399, water: false, createdTick: 0, obstacleRevision: "0", context,
  });
  return { planner, make, requestOn, request: (key: string, context: Context) => requestOn(planner, key, context) };
}

describe("route planner slot partition (R2-P3, scheduling v5)", () => {
  it("still accepts AI work while 8 human seats each hold 16 interactive jobs", () => {
    const f = fixture();
    // Eight seats ask for 20 jobs each: the per-seat and aggregate caps bind.
    for (let seat = 1; seat <= 8; seat++)
      for (let i = 0; i < 20; i++) f.request(`h${seat}:${i}`, { playerId: seat, human: true });
    expect(f.planner.pendingCount).toBe(PLANNER_PARTITION.interactiveTotal);
    // Background work keeps its half of the queue.
    expect(f.request("ai:0", { playerId: 20, human: false })).toBe(true);
    for (let i = 1; i < 100; i++) f.request(`ai:${i}`, { playerId: 20 + (i % 5), human: false });
    expect(f.planner.pendingCount - PLANNER_PARTITION.interactiveTotal)
      .toBe(128 - PLANNER_PARTITION.interactiveTotal - PLANNER_PARTITION.committedReserve);
    // Committed trade still has its reserve.
    for (let i = 0; i < PLANNER_PARTITION.committedReserve; i++)
      expect(f.request(`trade:${i}`, { playerId: 30, human: false, committed: true })).toBe(true);
    expect(f.request("trade:over", { playerId: 30, human: false, committed: true })).toBe(false);
    expect(f.planner.pendingCount).toBe(128);
  });

  it("keeps the version 4 background thresholds while humans leave their share idle", () => {
    const f = fixture();
    for (let i = 0; i < 104; i++) expect(f.request(`ai:${i}`, { playerId: 20, human: false })).toBe(true);
    expect(f.request("ai:over", { playerId: 20, human: false })).toBe(false);
    for (let i = 0; i < 16; i++) expect(f.request(`trade:${i}`, { playerId: 30, human: false, committed: true })).toBe(true);
    expect(f.request("trade:over", { playerId: 30, human: false, committed: true })).toBe(false);
    // The last 8 slots stay interactive, as in version 4.
    expect(f.request("h1:0", { playerId: 1, human: true })).toBe(true);
  });

  it("caps one seat at 16 interactive jobs without blocking other seats", () => {
    const f = fixture();
    for (let i = 0; i < PLANNER_PARTITION.interactivePerPlayer; i++)
      expect(f.request(`h1:${i}`, { playerId: 1, human: true })).toBe(true);
    expect(f.request("h1:over", { playerId: 1, human: true })).toBe(false);
    expect(f.request("h2:0", { playerId: 2, human: true })).toBe(true);
    expect(f.planner.diagnostics.admissionDeferred).toBe(1);
  });

  it("never refuses a same-key replacement at the caps", () => {
    const f = fixture();
    for (let i = 0; i < PLANNER_PARTITION.interactivePerPlayer; i++) f.request(`h1:${i}`, { playerId: 1, human: true });
    expect(f.request("h1:0", { playerId: 1, human: true })).toBe(true);
    expect(f.planner.diagnostics.admissionDeferred).toBe(0);
  });

  it("restores a version 4 checkpoint with the old thresholds", () => {
    const f = fixture();
    f.request("h1:0", { playerId: 1, human: true });
    const saved = f.planner.checkpoint();
    expect(saved.scheduling.version).toBe(6);
    const legacy = f.make();
    legacy.restore({ ...saved, scheduling: { ...saved.scheduling, version: 4 } });
    // Version 4: interactive work is uncapped below the 128 hard limit.
    for (let i = 1; i < 40; i++) expect(f.requestOn(legacy, `h1:${i}`, { playerId: 1, human: true })).toBe(true);
    expect(legacy.checkpoint().scheduling.version).toBe(4);
    const current = f.make();
    current.restore(saved);
    for (let i = 1; i < 40; i++) f.requestOn(current, `h1:${i}`, { playerId: 1, human: true });
    expect(current.pendingCount).toBe(PLANNER_PARTITION.interactivePerPlayer);
  });
});

describe("route planner slot partition, scheduling v6 (Next #1 remediation)", () => {
  it("keeps four of a seat's slots for movement admission", () => {
    const f = fixture();
    const navigation = (key: string) => f.request(key, { playerId: 1, human: true, caller: "navigation" });
    for (let i = 0; i < PLANNER_PARTITION.interactivePerPlayer - PLANNER_PARTITION.admissionReserve; i++)
      expect(navigation(`nav:${i}`)).toBe(true);
    // Pursuit and continuation work stops at 12; the move the player orders next still gets a slot.
    expect(navigation("nav:over")).toBe(false);
    for (let i = 0; i < PLANNER_PARTITION.admissionReserve; i++)
      expect(f.request(`move:${i}`, { playerId: 1, human: true })).toBe(true);
    expect(f.request("move:over", { playerId: 1, human: true })).toBe(false);
    // Another seat is unaffected.
    expect(f.request("nav2:0", { playerId: 2, human: true, caller: "navigation" })).toBe(true);
  });

  it("frees a seat's share on the tick its job is cancelled (rec 5)", () => {
    const f = fixture();
    for (let i = 0; i < PLANNER_PARTITION.interactivePerPlayer; i++) f.request(`h1:${i}`, { playerId: 1, human: true });
    expect(f.request("h1:new", { playerId: 1, human: true })).toBe(false);
    f.planner.cancel("h1:0");
    // The cancelled job still reclaims its arena slots, but no longer holds the seat's share.
    expect(f.planner.pendingCount).toBe(PLANNER_PARTITION.interactivePerPlayer);
    expect(f.request("h1:new", { playerId: 1, human: true })).toBe(true);
  });

  it("restores a version 5 checkpoint with version 5 counting", () => {
    const f = fixture();
    for (let i = 0; i < PLANNER_PARTITION.interactivePerPlayer; i++) f.request(`h1:${i}`, { playerId: 1, human: true, caller: i < 4 ? "admission" : "navigation" });
    f.planner.cancel("h1:0");
    const saved = f.planner.checkpoint(), legacy = f.make();
    legacy.restore({ ...saved, scheduling: { ...saved.scheduling, version: 5 } });
    expect(f.requestOn(legacy, "h1:new", { playerId: 1, human: true })).toBe(false);
    expect(legacy.checkpoint().scheduling.version).toBe(5);
    const current = f.make();
    current.restore(saved);
    expect(f.requestOn(current, "h1:new", { playerId: 1, human: true })).toBe(true);
  });
});
