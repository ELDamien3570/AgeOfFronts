import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";

describe("interactive resident-set scheduling v9", () => {
  it("bounds allocations per seat, serves background work and restores active ownership", () => {
    const map = new GameMapImpl(
        180,
        100,
        new Uint8Array(18000).fill(133),
        18000,
      ),
      results: { key: string; outcome: string }[] = [];
    const make = () =>
      new RoutePlanner(
        new LandPaths(map, false),
        new WaterPaths(map, false),
        {
          responsiveScheduling: true,
          priority: (r: { context: number }) => r.context < 3,
          identity: (r: { context: number }) => ({
            playerId: r.context,
            caller: "admission" as const,
          }),
          valid: () => true,
          obstacleRevision: () => "0",
          blocked: () => undefined,
          corridorReady: () => false,
          completed: (r: { key: string }, outcome: string) =>
            results.push({ key: r.key, outcome }),
        },
        128,
        32768,
      );
    let planner = make();
    for (const player of [1, 2, 3])
      for (let n = 0; n < 6; n++)
        expect(
          planner.request({
            key: player + ":" + n,
            context: player,
            start: map.ref(2, 2 + n),
            goal: map.ref(40, 30 + n),
            water: false,
            createdTick: 0,
            obstacleRevision: "0",
          }),
        ).toBe(true);
    for (let tick = 0; tick < 1500 && planner.pendingCount; tick++) {
      expect(planner.step(tick, 64, 16)).toBeLessThanOrEqual(64);
      const saved = planner.checkpoint();
      for (const player of [1, 2])
        expect(
          saved.jobs.filter(
            (j) =>
              j.context === player &&
              !j.retired &&
              !j.discard &&
              !j.releasing &&
              j.search.nodes.size > 0,
          ).length,
        ).toBeLessThanOrEqual(2);
      expect(planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(32768);
      if (tick === 30) {
        const next = make();
        next.restore(saved);
        expect(next.checkpoint()).toEqual(saved);
        planner = next;
      }
    }
    expect(results).toHaveLength(18);
    expect(results.every((r) => r.outcome === "complete")).toBe(true);
    expect(planner.pendingCount).toBe(0);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("leaves resident and allocation capacity for a new move while pursuit is busy", () => {
    const map = new GameMapImpl(
        180,
        100,
        new Uint8Array(18000).fill(133),
        18000,
      ),
      done: string[] = [];
    const planner = new RoutePlanner(
      new LandPaths(map, false),
      new WaterPaths(map, false),
      {
        responsiveScheduling: true,
        priority: () => true,
        identity: (r: { context: "admission" | "navigation" }) => ({
          playerId: 1,
          caller: r.context,
        }),
        valid: () => true,
        obstacleRevision: () => "0",
        blocked: () => undefined,
        corridorReady: () => false,
        completed: (r: { key: string }, outcome) => {
          if (outcome === "complete") done.push(r.key);
        },
      },
      128,
      4096,
    );
    const request = (
      key: string,
      context: "admission" | "navigation",
      start: number,
      goal: number,
    ) =>
      planner.request({
        key,
        context,
        start,
        goal,
        water: false,
        createdTick: 0,
        obstacleRevision: "0",
      });
    request("pursuit-a", "navigation", 0, 17999);
    request("pursuit-b", "navigation", 1, 17998);
    planner.step(0, 32, 8);
    request("move", "admission", 181, 182);
    for (let tick = 1; tick < 8 && !done.includes("move"); tick++)
      planner.step(tick, 128, 16);
    expect(done).toContain("move");
    expect(planner.has("pursuit-a")).toBe(true);
    expect(
      planner.checkpoint().jobs.find((j) => j.key === "pursuit-b")!.search.nodes
        .size,
    ).toBe(0);
  });
  it("retains scheduling v8 for an existing checkpoint", () => {
    const map = new GameMapImpl(8, 8, new Uint8Array(64).fill(133), 64);
    const p = new RoutePlanner(
      new LandPaths(map, false),
      new WaterPaths(map, false),
      {
        responsiveScheduling: true,
        valid: () => true,
        obstacleRevision: () => "0",
        blocked: () => undefined,
        completed: () => {},
      },
    );
    const old = p.checkpoint();
    old.scheduling.version = 8;
    p.restore(old);
    expect(p.checkpoint().scheduling.version).toBe(8);
  });
});
