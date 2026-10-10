import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import {
  RoutePlanner,
  type ExactRouteOutcome,
} from "../../src/skirmish/RoutePlanner";

function fixture() {
  const map = new GameMapImpl(
    180,
    100,
    new Uint8Array(18_000).fill(133),
    18_000,
  );
  const land = new LandPaths(map, false),
    water = new WaterPaths(map, false);
  const results: { key: string; outcome: ExactRouteOutcome; path: number[] }[] =
    [];
  const validity = new Map<string, boolean>(),
    revision = { value: "0" };
  const planner = new RoutePlanner<number>(land, water, {
    valid: (r) => validity.get(r.key) !== false,
    obstacleRevision: () => revision.value,
    blocked: () => undefined,
    completed: (r, outcome, path) =>
      results.push({ key: r.key, outcome, path }),
  });
  const request = (key: string, start: number, goal: number, sea = false) =>
    planner.request({
      key,
      start,
      goal,
      water: sea,
      createdTick: 0,
      obstacleRevision: revision.value,
      context: 1,
    });
  return { map, land, planner, results, validity, revision, request };
}
describe("fair resumable exact planning", () => {
  it("releases a restored background arena reservation so a human route can start", () => {
    const { map, land } = fixture();
    const outcomes: { key: string; outcome: ExactRouteOutcome }[] = [];
    const ports = {
      priority: (r: { context: number }) => r.context === 1,
      valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
      completed: (r: { key: string }, outcome: ExactRouteOutcome) => outcomes.push({ key: r.key, outcome }),
    };
    const old = new RoutePlanner<number>(land, new WaterPaths(map, false), ports, 128, 64);
    old.request({ key: "ai", start: 0, goal: 17999, water: false, createdTick: 0, obstacleRevision: "0", context: 2 });
    for (let tick = 0; tick < 1000 && !old.checkpoint().jobs[0]?.waitingForWorkspace; tick++) old.step(tick, 1, 1);
    expect(old.checkpoint().jobs[0]?.waitingForWorkspace).toBe(true);
    const restored = new RoutePlanner<number>(land, new WaterPaths(map, false), ports, 128, 64);
    restored.restore(old.checkpoint());
    restored.request({ key: "human", start: map.ref(1, 1), goal: map.ref(2, 1), water: false, createdTick: 1000, obstacleRevision: "0", context: 1 });
    for (let tick = 1000; tick < 1020 && !outcomes.some(o => o.key === "human"); tick++) restored.step(tick, 32, 4);
    expect(outcomes).toContainEqual({ key: "human", outcome: "complete" });
  });
  it("returns capacity-limited background work without taking an exclusive arena retry", () => {
    const {map,land}=fixture(), outcomes:ExactRouteOutcome[]=[];
    const planner=new RoutePlanner<number>(land,new WaterPaths(map,false),{
      allowExclusiveRetry:()=>false,valid:()=>true,obstacleRevision:()=>"0",blocked:()=>undefined,
      completed:(_request,outcome)=>outcomes.push(outcome),
    },128,64);
    planner.request({key:"trade",start:0,goal:17999,water:false,createdTick:0,obstacleRevision:"0",context:1});
    for(let tick=0;planner.diagnostics.pending&&tick<1000;tick++)planner.step(tick,32,4);
    expect(outcomes).toEqual(["limited"]);
    expect(planner.diagnostics.escalated).toBe(0);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("preempts an active AI arena retry with charged cleanup and preserves its retry across restore", () => {
    const { map, land } = fixture(), outcomes: { key: string; outcome: ExactRouteOutcome }[] = [];
    const ports = {
      priority: (r: { context: number }) => r.context === 1,
      valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
      completed: (r: { key: string }, outcome: ExactRouteOutcome) => outcomes.push({ key: r.key, outcome }),
    };
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), ports, 128, 64);
    planner.request({ key: "ai", start: 0, goal: 17999, water: false, createdTick: 0, obstacleRevision: "0", context: 2 });
    for (let tick = 0; tick < 1000 && !planner.checkpoint().scheduling.exclusiveKey; tick++) planner.step(tick, 1, 1);
    expect(planner.checkpoint().scheduling.exclusiveKey).toBe("ai");
    expect(planner.checkpoint().jobs[0].search.nodes.size).toBeGreaterThan(0);
    planner.request({ key: "human", start: map.ref(1, 1), goal: map.ref(2, 1), water: false, createdTick: 1000, obstacleRevision: "0", context: 1 });
    expect(planner.step(1000, 1, 1)).toBe(1);
    const checkpoint = planner.checkpoint();
    expect(checkpoint.jobs.find(j => j.key === "ai")?.resumeExclusiveAfterRelease).toBe(true);
    const restored = new RoutePlanner<number>(land, new WaterPaths(map, false), ports, 128, 64);
    restored.restore(checkpoint);
    for (let tick = 1001; tick < 1020 && !outcomes.some(o => o.key === "human"); tick++) expect(restored.step(tick, 16, 4)).toBeLessThanOrEqual(16);
    expect(outcomes).toContainEqual({ key: "human", outcome: "complete" });
    expect(outcomes.some(o => o.key === "ai")).toBe(false);
    expect(restored.checkpoint().jobs.find(j => j.key === "ai")?.exclusiveRetry).toBe(true);
  });
  it("gives human routes two thirds of contested work, without starving background routes", () => {
    const {map,land}=fixture(), planner=new RoutePlanner<{playerId:number}>(land,new WaterPaths(map,false),{
      identity:r=>({playerId:r.context.playerId,caller:"admission"}), priority:r=>r.context.playerId===1,
      valid:()=>true,obstacleRevision:()=>"0",blocked:()=>undefined,completed:()=>{},
    });
    for(const playerId of [1,2]) planner.request({key:`p${playerId}`,start:0,goal:17999,water:false,createdTick:0,obstacleRevision:"0",context:{playerId}});
    expect(planner.step(1,60,1)).toBe(60);
    const cohorts=planner.diagnosticCohorts(1);
    expect(cohorts.find(c=>c.playerId===1)?.work).toBe(40);
    expect(cohorts.find(c=>c.playerId===2)?.work).toBe(20);
    expect(planner.checkpoint().scheduling.priorityTurn).toBe(60);
  });
  it("attributes bounded work and cancellation to faction/caller cohorts outside checkpoints", () => {
    const { map, land } = fixture();
    const planner = new RoutePlanner<{ playerId: number }>(land, new WaterPaths(map, false), {
      identity: request => ({ playerId: request.context.playerId, caller: "admission" }),
      valid: () => true, obstacleRevision: () => "0", blocked: () => undefined, completed: () => {},
    });
    for (const playerId of [1, 2, -3]) planner.request({ key: `player:${playerId}`, start: 0, goal: map.ref(20, 20),
      water: false, createdTick: 0, obstacleRevision: "0", context: { playerId } });
    const before = planner.checkpoint();
    const initial = planner.diagnosticCohorts(10);
    expect(initial.map(cohort => cohort.playerId)).toEqual([1, 2, 0]);
    expect(initial.every(cohort => cohort.pending === 1 && cohort.oldestAge === 10)).toBe(true);
    initial[0].pending = 999;
    expect(planner.checkpoint()).toEqual(before);
    expect(planner.diagnosticCohorts(10)[0].pending).toBe(1);
    expect(planner.step(10, 9, 3)).toBe(9);
    expect(planner.diagnosticCohorts(10).reduce((sum, cohort) => sum + cohort.work, 0)).toBe(9);
    planner.cancel("player:1");
    while (planner.diagnostics.pending) planner.step(10, 32, 4);
    const final = planner.diagnosticCohorts(10);
    expect(final.find(cohort => cohort.playerId === 1)?.superseded).toBe(1);
    expect(final.every(cohort => cohort.pending === 0)).toBe(true);
  });
  it("bounds shared storage, reports exhaustion as unknown and charges cancellation cleanup", () => {
    const { map, land } = fixture(),
      outcomes: ExactRouteOutcome[] = [];
    const planner = new RoutePlanner(
      land,
      new WaterPaths(map, false),
      {
        valid: () => true,
        obstacleRevision: () => "0",
        blocked: () => undefined,
        completed: (_, outcome) => outcomes.push(outcome),
      },
      2,
      64,
    );
    const request = (key: string, goal: number) =>
      planner.request({
        key,
        start: 0,
        goal,
        water: false,
        createdTick: 0,
        obstacleRevision: "0",
        context: null,
      });
    expect(request("long", 17999)).toBe(true);
    expect(request("short", map.ref(2, 2))).toBe(true);
    expect(request("overflow", 4)).toBe(false);
    while (planner.diagnostics.pending) {
      expect(planner.step(0, 7, 2)).toBeLessThanOrEqual(7);
      expect(planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(64);
    }
    expect(outcomes).toContain("limited");
    expect(outcomes).toContain("complete");
    expect(planner.diagnostics.workspaceBytes).toBe(64 * 32);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
    request("cancel", 17999);
    planner.step(0, 8, 2);
    const occupied = planner.diagnostics.workspaceUsed;
    expect(occupied).toBeGreaterThan(1);
    planner.cancel("cancel");
    planner.step(1, 1, 1);
    expect(planner.diagnostics.workspaceUsed).toBe(occupied - 1);
    while (planner.diagnostics.pending) planner.step(1, 3, 2);
    expect(outcomes).toHaveLength(2);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("coalesces a newer request while releasing the old search without leaking arena slots", () => {
    const { planner, request, results } = fixture();
    request("replace", 0, 17999);
    planner.step(0, 13, 3);
    request("replace", 0, 4);
    const restored = fixture();
    restored.planner.restore(planner.checkpoint());
    while (planner.diagnostics.pending)
      expect(restored.planner.step(1, 17, 3)).toBe(planner.step(1, 17, 3));
    expect(results).toEqual(restored.results);
    expect(results).toHaveLength(1);
    expect(results[0].path[results[0].path.length - 1]).toBe(4);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("publishes a completed route before its workspace release finishes", () => {
    const { planner, request, results, revision } = fixture();
    request("finished", 0, 4);
    for (let tick = 0; tick < 50 && !results.length; tick++) planner.step(tick, 1, 1);
    expect(results).toEqual([{ key: "finished", outcome: "complete", path: [0, 1, 2, 3, 4] }]);
    // Reclamation continues under its own key, charged and checkpointed.
    expect(planner.diagnostics.workspaceUsed).toBeGreaterThan(0);
    expect(planner.has("finished")).toBe(false);
    const restored = fixture();
    restored.planner.restore(planner.checkpoint());
    expect(restored.planner.checkpoint()).toEqual(planner.checkpoint());
    // A later obstacle change cannot retract an already accepted route.
    revision.value = "changed";
    while (planner.diagnostics.pending) expect(planner.step(51, 2, 1)).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(1);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
    expect(planner.diagnostics.superseded).toBe(0);
  });
  it("starts a same-key follow-up request while the previous search is still being reclaimed", () => {
    const { planner, request, results } = fixture();
    request("member", 0, 4);
    for (let tick = 0; tick < 50 && !results.length; tick++) planner.step(tick, 1, 1);
    expect(planner.diagnostics.workspaceUsed).toBeGreaterThan(0);
    expect(request("member", 4, 8)).toBe(true);
    expect(planner.has("member")).toBe(true);
    while (planner.diagnostics.pending) planner.step(60, 3, 1);
    expect(results.map(r => [r.key, r.outcome, r.path[0], r.path[r.path.length - 1]])).toEqual([
      ["member", "complete", 0, 4], ["member", "complete", 4, 8],
    ]);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("completes a long interactive route through the HPA* corridor in one tick", () => {
    const { map, land } = fixture(), outcomes: { key: string; path: number[] }[] = [];
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), {
      priority: r => r.context === 1, valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
      completed: (r, outcome, path) => { expect(outcome).toBe("complete"); outcomes.push({ key: r.key, path }); },
    });
    const start = map.ref(1, 1), goal = map.ref(175, 95);
    planner.request({ key: "human", start, goal, water: false, createdTick: 0, obstacleRevision: "0", context: 1 });
    planner.request({ key: "ai", start, goal, water: false, createdTick: 0, obstacleRevision: "0", context: 2 });
    planner.step(0);
    expect(outcomes.map(o => o.key)).toEqual(["human"]);
    const path = outcomes[0].path;
    expect(path[0]).toBe(start);
    expect(path[path.length - 1]).toBe(goal);
    for (let i = 1; i < path.length; i++)
      expect(Math.max(Math.abs(map.x(path[i]) - map.x(path[i - 1])), Math.abs(map.y(path[i]) - map.y(path[i - 1])))).toBe(1);
    // Near-optimal: an open map's octile distance is 174 steps.
    expect(path.length - 1).toBeLessThanOrEqual(Math.ceil(174 * 1.1));
    expect(planner.checkpoint().jobs.map(j => j.key)).toEqual(["ai"]);
  });
  it("falls back to exact search when a wall crosses the interactive corridor", () => {
    const { map, land } = fixture(), outcomes: number[][] = [];
    const wall = new Set<number>();
    for (let y = 0; y < 99; y++) wall.add(map.ref(90, y));
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), {
      priority: () => true, valid: () => true, obstacleRevision: () => "0", blocked: () => tile => wall.has(tile),
      completed: (_r, outcome, path) => { expect(outcome).toBe("complete"); outcomes.push(path); },
    });
    planner.request({ key: "human", start: map.ref(1, 1), goal: map.ref(175, 2), water: false, createdTick: 0, obstacleRevision: "0", context: 1 });
    for (let tick = 0; planner.diagnostics.pending && tick < 200; tick++) planner.step(tick);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].some(tile => map.y(tile) === 99)).toBe(true);
    expect(outcomes[0].every(tile => !wall.has(tile))).toBe(true);
  });
  it("keeps an unfinished search through terrain cost changes, which never alter walkability", () => {
    const { map, land, planner, results, request } = fixture();
    request("long", map.ref(1, 1), map.ref(175, 95));
    planner.step(0, 300, 32);
    expect(planner.checkpoint().jobs[0].search.nodes.size).toBeGreaterThan(0);
    // Simulate a forest clearing elsewhere bumping the cost epoch mid-search.
    land.restoreRevision(land.revision + 1);
    while (planner.diagnostics.pending) planner.step(1, 512, 32);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("complete");
    expect(results[0].path[results[0].path.length - 1]).toBe(map.ref(175, 95));
    expect(planner.diagnostics.superseded).toBe(0);
  });
  it("tests another firing finalist when the geometric favorite is enclosed by obstacles", () => {
    const { map, land } = fixture(),
      first = map.ref(6, 6),
      second = map.ref(4, 4),
      blocked = new Set<number>();
    for (let y = 5; y <= 7; y++)
      for (let x = 5; x <= 7; x++)
        if (x !== 6 || y !== 6) blocked.add(map.ref(x, y));
    const paths: number[][] = [];
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), {
      valid: () => true,
      obstacleRevision: () => "0",
      blocked: () => (tile) => blocked.has(tile),
      completed: (_, outcome, path) => {
        expect(outcome).toBe("complete");
        paths.push(path);
      },
    });
    planner.request({
      key: "shot",
      start: map.ref(1, 1),
      goal: first,
      alternatives: [second],
      water: false,
      createdTick: 0,
      obstacleRevision: "0",
      context: 1,
    });
    let ticks = 0;
    while (planner.diagnostics.pending) {
      expect(planner.step(ticks++, 97, 11)).toBeLessThanOrEqual(97);
      expect(ticks).toBeLessThan(1000);
    }
    expect(paths[0][paths[0].length - 1]).toBe(second);
    expect(paths[0].every((tile) => !blocked.has(tile))).toBe(true);
  });
  it("charges search, reconstruction, copying and zero-length completion before publishing", () => {
    const { map, planner, results, request } = fixture();
    request("long", map.ref(1, 1), map.ref(175, 95));
    request("short", map.ref(2, 2), map.ref(4, 3));
    for (let tick = 0; planner.diagnostics.pending; tick++)
      expect(planner.step(tick, 13, 3)).toBeLessThanOrEqual(13);
    expect(results.map((r) => r.key)).toEqual(["short", "long"]);
    expect(results.every((r) => r.outcome === "complete")).toBe(true);
    expect(results[1].path[0]).toBe(map.ref(1, 1));
    expect(results[1].path[results[1].path.length - 1]).toBe(map.ref(175, 95));
    request("zero", 0, 0);
    while (planner.diagnostics.pending) expect(planner.step(1, 1, 1)).toBe(1);
    expect(results[results.length - 1].path).toEqual([0]);
  });
  it("restores unfinished search and publication copying in the same FIFO schedule", () => {
    const first = fixture(),
      second = fixture();
    first.request("a", 0, 17999);
    first.request("b", 180, 17000);
    first.planner.step(1, 17, 3);
    second.planner.restore(first.planner.checkpoint());
    while (first.planner.diagnostics.pending)
      expect(second.planner.step(2, 257, 31)).toBe(
        first.planner.step(2, 257, 31),
      );
    expect(second.planner.checkpoint()).toEqual(first.planner.checkpoint());
    expect(second.results).toEqual(first.results);
  });
  it("separates superseded owners, revalidated revisions, physical disconnection and canceled work", () => {
    const { planner, results, request, revision, validity } = fixture();
    request("changed", 0, 17999);
    request("invalid", 0, 17999);
    planner.step(1, 2, 1);
    // An obstacle revision no longer discards progress: the plain route keeps
    // searching under the live mask and is revalidated when it completes.
    revision.value = "1";
    validity.set("invalid", false);
    request("sea", 0, 100, true);
    request("canceled", 0, 5);
    planner.cancel("canceled");
    while (planner.diagnostics.pending) planner.step(2, 9, 2);
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ["sea", "unreachable"],
      ["invalid", "superseded"],
      ["changed", "complete"],
    ]);
  });
  it("supersedes a search whose finished path crosses an obstacle added mid-search", () => {
    const { map, land } = fixture(), outcomes: string[] = [];
    let revision = "0";
    const wall = new Set<number>();
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), {
      valid: () => true, obstacleRevision: () => revision, blocked: () => tile => wall.has(tile),
      completed: (_r, outcome) => outcomes.push(outcome),
    });
    planner.request({ key: "route", start: map.ref(1, 50), goal: map.ref(170, 50), water: false, createdTick: 0, obstacleRevision: "0", context: 1 });
    // Let the search settle the start region, then wall a cell it already closed.
    planner.step(0, 200, 32);
    for (let y = 40; y <= 60; y++) wall.add(map.ref(2, y));
    revision = "1";
    while (planner.diagnostics.pending) planner.step(1, 512, 32);
    expect(outcomes).toEqual(["superseded"]);
  });
});
