import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";
import type { PlannerCaller } from "../../src/skirmish/RuntimeDiagnostics";

function fixture() {
  const map = new GameMapImpl(80, 80, new Uint8Array(6400).fill(133), 6400);
  const turns: string[] = [];
  const planner = new RoutePlanner<{ playerId: number; caller: PlannerCaller }>(
    new LandPaths(map, false),
    new WaterPaths(map, false),
    {
      identity: (r) => r.context,
      valid: () => true,
      obstacleRevision: () => "0",
      blocked: () => undefined,
      completed: () => {},
      prepare: (r) => {
        turns.push(r.key);
        return { work: 1 };
      },
    },
  );
  const request = (
    key: string,
    playerId: number,
    caller: PlannerCaller = "admission",
  ) =>
    planner.request({
      key,
      start: 0,
      goal: 6399,
      prepare: true,
      water: false,
      createdTick: 0,
      obstacleRevision: "0",
      context: { playerId, caller },
    });
  return { planner, turns, request };
}

describe("P11 player and command class shares", () => {
  it("gives a sparse faction equal turns despite another faction's many jobs", () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) f.request(`crowded:${i}`, 1);
    f.request("sparse", 2);
    for (let tick = 0; tick < 12; tick++)
      expect(f.planner.step(tick, 1, 1)).toBe(1);
    expect(f.turns.filter((key) => key === "sparse")).toHaveLength(6);
  });
  it("rotates classes within a player's share, retaining old FIFO jobs under arrivals", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) f.request(`human:${i}`, 1);
    f.request("defense", 1, "defense");
    f.request("trade", 1, "trade");
    for (let tick = 0; tick < 12; tick++) {
      f.request(`new:${tick}`, 1);
      f.planner.step(tick, 1, 1);
    }
    expect(f.turns.filter((key) => key === "defense")).toHaveLength(4);
    expect(f.turns.filter((key) => key === "trade")).toHaveLength(4);
    expect(f.turns.filter((key) => key.startsWith("human:"))).toEqual([
      "human:0",
      "human:1",
      "human:2",
      "human:3",
    ]);
  });
  it("serves 54 factions and two classes without starvation inside the 128-job limit", () => {
    const f = fixture();
    for (let player = 1; player <= 54; player++) {
      f.request(`human:${player}`, player);
      f.request(`defense:${player}`, player, "defense");
    }
    for (let tick = 0; tick < 216; tick++)
      expect(f.planner.step(tick, 1, 1)).toBe(1);
    const counts = new Map<string, number>();
    for (const key of f.turns) counts.set(key, (counts.get(key) ?? 0) + 1);
    expect(counts.size).toBe(108);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
    expect(
      f.planner.diagnosticCohorts(216).every((c) => c.oldestAge === 216),
    ).toBe(true);
  });
  it("restores historical checkpoints with their FIFO scheduling contract", () => {
    const a = fixture(),
      b = fixture();
    a.request("first", 1);
    a.request("second", 1);
    a.request("third", 2);
    const { scheduling, ...legacy } = a.planner.checkpoint();
    expect(scheduling.version).toBe(3);
    b.planner.restore(legacy);
    for (let tick = 0; tick < 3; tick++) b.planner.step(tick, 1, 1);
    expect(b.turns).toEqual(["first", "second", "third"]);
    expect(b.planner.checkpoint().scheduling.version).toBe(1);
  });
  it("persists the next faction/class turn across restore", () => {
    const a = fixture(),
      b = fixture();
    a.request("one", 1);
    a.request("two", 2);
    a.request("trade", 1, "trade");
    a.planner.step(0, 1, 1);
    b.planner.restore(a.planner.checkpoint());
    a.turns.length = 0;
    for (let tick = 1; tick < 13; tick++) {
      expect(b.planner.step(tick, 1, 1)).toBe(a.planner.step(tick, 1, 1));
    }
    expect(b.turns).toEqual(a.turns);
    expect(b.planner.checkpoint()).toEqual(a.planner.checkpoint());
  });
});

describe("P11 capacity escalation", () => {
  function cohort() {
    const map = new GameMapImpl(80, 80, new Uint8Array(6400).fill(133), 6400);
    const outcomes: { key: string; outcome: string; path: number[] }[] = [];
    const planner = new RoutePlanner<{
      playerId: number;
      caller: PlannerCaller;
    }>(
      new LandPaths(map, false),
      new WaterPaths(map, false),
      {
        identity: (r) => r.context,
        valid: () => true,
        obstacleRevision: () => "0",
        blocked: () => undefined,
        completed: (r, outcome, path) =>
          outcomes.push({ key: r.key, outcome, path }),
      },
      128,
      128,
    );
    const request = (key: string, playerId: number, goal = map.ref(16, 16)) =>
      planner.request({
        key,
        start: 0,
        goal,
        water: false,
        createdTick: 0,
        obstacleRevision: "0",
        context: { playerId, caller: "admission" },
      });
    return { map, planner, outcomes, request };
  }
  it("completes searches that fit alone but exhaust a shared arena together", () => {
    const a = cohort(),
      b = cohort();
    a.request("one", 1);
    a.request("two", 2, a.map.ref(16, 17));
    let restored = false;
    for (let tick = 0; a.planner.diagnostics.pending; tick++) {
      expect(tick).toBeLessThan(3000);
      const used = a.planner.step(tick, 7, 2);
      expect(used).toBeLessThanOrEqual(7);
      expect(a.planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(128);
      if (restored) expect(b.planner.step(tick, 7, 2)).toBe(used);
      else if (a.planner.checkpoint().jobs.some((j) => j.exclusiveRetry)) {
        b.planner.restore(a.planner.checkpoint());
        b.outcomes.push(...structuredClone(a.outcomes));
        restored = true;
      }
    }
    expect(restored).toBe(true);
    expect(a.outcomes.map((r) => r.outcome)).toEqual(["complete", "complete"]);
    expect(b.outcomes).toEqual(a.outcomes);
    expect(b.planner.checkpoint()).toEqual(a.planner.checkpoint());
    expect(a.planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("reports actual arena exhaustion as limited after one exclusive retry, never unreachable", () => {
    const f = cohort();
    f.request("oversize", 1, 6399);
    for (let tick = 0; f.planner.diagnostics.pending; tick++) {
      expect(tick).toBeLessThan(3000);
      expect(f.planner.step(tick, 7, 2)).toBeLessThanOrEqual(7);
    }
    expect(f.outcomes).toEqual([
      { key: "oversize", outcome: "limited", path: [] },
    ]);
    expect(f.planner.diagnostics.escalated).toBe(1);
    expect(f.planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("reclaims a canceled escalation under continuing arrivals", () => {
    const f = cohort();
    f.request("old", 1, 6399);
    f.request("other", 2, 6399);
    let cancelAt = -1;
    for (let tick = 0; tick < 3000; tick++) {
      if (
        cancelAt < 0 &&
        f.planner
          .checkpoint()
          .jobs.some((j) => j.key === "old" && j.exclusiveRetry)
      ) {
        f.planner.cancel("old");
        cancelAt = tick;
      }
      f.request(`arrival:${tick}`, 3, 1);
      expect(f.planner.step(tick, 31, 3)).toBeLessThanOrEqual(31);
      expect(f.planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(128);
      if (
        cancelAt >= 0 &&
        !f.planner.checkpoint().jobs.some((j) => j.key === "old")
      )
        break;
    }
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(f.planner.checkpoint().jobs.some((j) => j.key === "old")).toBe(
      false,
    );
    expect(f.outcomes.some((r) => r.key === "old")).toBe(false);
  });
});
