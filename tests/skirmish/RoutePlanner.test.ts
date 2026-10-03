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
  it("revalidates a completed route after incremental workspace release", () => {
    const { planner, request, results, revision } = fixture();
    request("finished", 0, 4);
    for (let tick = 0; tick < 50; tick++) {
      planner.step(tick, 1, 1);
      if (planner.checkpoint().jobs[0]?.releasing === "complete") break;
    }
    expect(planner.checkpoint().jobs[0]?.releasing).toBe("complete");
    revision.value = "changed";
    while (planner.diagnostics.pending) planner.step(51, 2, 1);
    expect(results).toEqual([
      { key: "finished", outcome: "superseded", path: [] },
    ]);
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
  it("separates superseded revisions, physical disconnection and canceled work", () => {
    const { planner, results, request, revision } = fixture();
    request("changed", 0, 17999);
    planner.step(1, 2, 1);
    revision.value = "1";
    request("sea", 0, 100, true);
    request("canceled", 0, 5);
    planner.cancel("canceled");
    while (planner.diagnostics.pending) planner.step(2, 9, 2);
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ["sea", "unreachable"],
      ["changed", "superseded"],
    ]);
  });
});
