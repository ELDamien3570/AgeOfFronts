import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner, type ExactRouteOutcome } from "../../src/skirmish/RoutePlanner";

function fixture(capacity = 256) {
  const map = new GameMapImpl(180, 100, new Uint8Array(18000).fill(133), 18000);
  const land = new LandPaths(map, false), water = new WaterPaths(map, false);
  const results: {key: string; outcome: ExactRouteOutcome; path: number[]}[] = [];
  const ports = { balancedActiveAdmission: true, priority: (r: {context: number}) => r.context === 1,
    corridorReady: () => true, valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
    completed: (r: {key: string}, outcome: ExactRouteOutcome, path: number[]) => results.push({key: r.key, outcome, path}) };
  const make = () => new RoutePlanner(land, water, ports, 128, capacity);
  const planner = make();
  const request = (key: string, context: number, start = 0, goal = 17999) =>
    ({key, context, start, goal, water: false, createdTick: 0, obstacleRevision: "0"});
  return {map, land, planner, make, request, results};
}

describe("planner v8 interactive search memory", () => {
  it("finishes a restored human retry while a cold background corridor retains its nodes", () => {
    const f = fixture(), p = f.planner as any;
    f.planner.request(f.request("cold", 2));
    const cold = p.jobs.get("cold");
    cold.corridorTried = true;
    cold.corridor = f.land.beginCorridor(cold.start, cold.goal, cold.search.nodes);
    for (let n = 0; !cold.search.nodes.size && n < 1000; n++)
      f.land.stepCorridor(cold.corridor, p.workspace, 64, undefined, 32, {used: 0}, true);
    expect(cold.search.nodes.size).toBeGreaterThan(0);
    const frozen = f.land.stepCorridor.bind(f.land);
    f.land.stepCorridor = (state, ...args) => state.start === 0 ? 0 : frozen(state, ...args);
    f.planner.request(f.request("human", 1, f.map.ref(3, 3), f.map.ref(5, 3)));
    const saved = f.planner.checkpoint(), human = saved.jobs.find(j => j.key === "human")!;
    human.exclusiveRetry = true; human.waitingForWorkspace = true;
    const restored = f.make(); restored.restore(saved);
    const originalNodes = saved.jobs.find(j => j.key === "cold")!.search.nodes;
    for (let tick = 0; !f.results.some(r => r.key === "human") && tick < 12; tick++)
      expect(restored.step(tick, 128, 16)).toBeLessThanOrEqual(128);
    expect(f.results.find(r => r.key === "human")).toMatchObject({outcome: "complete"});
    expect(restored.checkpoint().jobs.find(j => j.key === "cold")!.search.nodes).toEqual(originalNodes);
    expect(restored.diagnostics.workspaceBytes).toBe(256 * 32);
    expect(restored.diagnostics.workspaceUsed).toBeLessThanOrEqual(256);
  });

  it("protects free slots under background pressure and preserves pressure/cleanup across restore", () => {
    const f = fixture(64);
    // Exact-only work fills the ordinary share; a long valid route is capacity
    // limited, never misreported as disconnected terrain.
    (f.planner as any).ports.corridorReady = () => false;
    f.planner.request(f.request("long", 2));
    for (let tick = 0; tick < 20 && !f.results.length; tick++) {
      f.planner.step(tick, 4, 1);
      expect(f.planner.checkpoint().jobs.filter(j => !j.interactiveMemory)
        .reduce((n, j) => n + j.search.nodes.size, 0)).toBeLessThanOrEqual(48);
      expect((f.planner as any).workspace.minimumFree).toBe(0);
    }
    const restored = f.make(); restored.restore(f.planner.checkpoint());
    restored.request(f.request("near", 1, 181, 182));
    for (let tick = 20; tick < 300 && restored.pendingCount; tick++)
      expect(restored.step(tick, 16, 4)).toBeLessThanOrEqual(16);
    expect(f.results.find(r => r.key === "near")).toMatchObject({outcome: "complete"});
    expect(f.results.find(r => r.key === "long")).toMatchObject({outcome: "limited"});
    expect(restored.diagnostics.workspaceUsed).toBe(0);
  });

  it("retains allocation ownership through controller changes, replacement and retirement", () => {
    const f = fixture();
    f.planner.request(f.request("old-human", 1));
    f.planner.step(0, 5, 1);
    const old = f.planner.checkpoint().jobs.find(j => j.key === "old-human")!;
    expect(old.interactiveMemory).toBe(true);
    (f.planner as any).ports.priority = () => false;
    f.planner.request(f.request("old-human", 2, 181, 182));
    const restored = f.make(); restored.restore(f.planner.checkpoint());
    for (let tick = 1; tick < 300 && restored.pendingCount; tick++) restored.step(tick, 64, 8);
    expect(restored.diagnostics.workspaceUsed).toBe(0);
    expect(f.results).toContainEqual({key: "old-human", outcome: "complete", path: [181, 182]});
  });

  it("keeps historical v7 saves on their original scheduling and derives owners only for an explicit v8 migration", () => {
    const f = fixture(), saved = f.planner.checkpoint();
    saved.scheduling.version = 7;
    f.planner.restore(saved);
    f.planner.request(f.request("old", 1));
    expect(f.planner.checkpoint().jobs[0].interactiveMemory).toBeUndefined();
    const upgrade = f.planner.checkpoint(); upgrade.scheduling.version = 8;
    f.planner.restore(upgrade);
    expect(f.planner.checkpoint().jobs[0].interactiveMemory).toBe(true);
    expect(f.planner.checkpoint().scheduling.version).toBe(8);
  });
});


it("does not let an inherited background exclusive retry block a new protected order after controller transfer", () => {
  const f = fixture(64), ports = (f.planner as any).ports;
  ports.priority = () => false; ports.corridorReady = () => false;
  f.planner.request(f.request("inherited", 2));
  for (let tick = 0; tick < 1000 && !f.planner.checkpoint().scheduling.exclusiveKey; tick++) f.planner.step(tick, 1, 1);
  expect(f.planner.checkpoint().scheduling.exclusiveKey).toBe("inherited");
  expect(f.planner.checkpoint().jobs[0].interactiveMemory).toBe(false);
  ports.priority = () => true;
  f.planner.request(f.request("new-order", 1, 181, 182));
  for (let tick = 1000; tick < 1012 && !f.results.some(r => r.key === "new-order"); tick++) f.planner.step(tick, 4, 1);
  expect(f.results.find(r => r.key === "new-order")).toMatchObject({outcome: "complete"});
});
