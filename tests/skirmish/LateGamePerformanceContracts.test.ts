import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { PlanningWorkspace } from "../../src/skirmish/PlanningWorkspace";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  SquadDetailCache,
  packSnapshotDetails,
} from "../../src/skirmish/SnapshotDetails";
import { RenderSamples } from "../../src/skirmish/client/RenderSamples";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
function map() {
  return new GameMapImpl(180, 100, new Uint8Array(18000).fill(133), 18000);
}
describe("late-game performance contracts", () => {
  it("does not repeatedly select background preparations that cannot progress this tick", () => {
    const m = map(), results: string[] = [];
    let preparation = 0;
    const planner = new RoutePlanner<number>(new LandPaths(m, false), new WaterPaths(m, false), {
      priority: () => false,
      corridorReady: r => r.context === 0,
      valid: () => true,
      obstacleRevision: () => "0",
      blocked: () => undefined,
      prepare: () => ({ work: 1, goal: ++preparation >= 128 ? m.ref(175, 95) : undefined }),
      completed: (r, outcome) => { if (outcome === "complete") results.push(r.key); },
    });
    for (let i = 0; i < 32; i++) planner.request({ key: `cold-${i}`, start: m.ref(1, 1), goal: m.ref(175, 95),
      water: false, createdTick: 0, obstacleRevision: "0", context: 0 });
    planner.request({ key: "exact", start: m.ref(1, 1), goal: m.ref(175, 95),
      water: false, createdTick: 0, obstacleRevision: "0", context: 1, prepare: true });
    let selections = 0;
    const owner = planner as any, select = owner.selectJob;
    owner.selectJob = function (...args: any[]) { selections++; return select.apply(this, args); };
    expect(planner.step(0)).toBeLessThanOrEqual(4096);
    expect(selections).toBeLessThan(300);
    expect(planner.checkpoint().jobs.find(j => j.key === "exact")!.search.expanded).toBeGreaterThan(32);
    expect(planner.diagnostics.pending).toBeGreaterThan(0);
    for (let tick = 1; tick < 20 && !results.includes("exact"); tick++) planner.step(tick);
    expect(results).toContain("exact");
    for (let i = 0; i < 32; i++) planner.cancel(`cold-${i}`);
    while (planner.diagnostics.pending) planner.step(1);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("restores charged cleanup after a late obstacle invalidates a corridor", () => {
    const m = map(), paths = new LandPaths(m, false), workspace = new PlanningWorkspace();
    const state = paths.beginCorridor(m.ref(1, 1), m.ref(175, 95), new Map())!;
    for (let turn = 0; state.phase !== "release" && state.phase !== "failed" && turn < 20000; turn++)
      paths.stepCorridor(state, workspace, 1, tile => tile === state.goal);
    expect(state.phase).toBe("release");
    expect(() => paths.validateCorridor(structuredClone(state), workspace)).not.toThrow();
    while (state.phase !== "failed") paths.stepCorridor(state, workspace, 7);
    expect(workspace.used).toBe(0);
  });
  it("resumes every corridor stage with identical work, cold or warmed caches", () => {
    const m = map(),
      cold = new LandPaths(m, false),
      warm = new LandPaths(m, false);
    warm.prepare();
    const wa = new PlanningWorkspace(),
      wb = new PlanningWorkspace();
    let a = cold.beginCorridor(m.ref(1, 1), m.ref(175, 95), new Map())!,
      b = warm.beginCorridor(a.start, a.goal, new Map())!;
    const phases = new Set<string>();
    let turns = 0;
    while (a.phase !== "done" && a.phase !== "failed" && turns++ < 20000) {
      phases.add(a.phase);
      expect(cold.stepCorridor(a, wa, 7)).toBe(warm.stepCorridor(b, wb, 7));
      expect(a.phase).toBe(b.phase);
      // A checkpoint restores query-owned heaps/trees, not shared query scratch.
      a = structuredClone(a);
      wa.restore(wa.checkpoint());
      b = structuredClone(b);
      wb.restore(wb.checkpoint());
    }
    expect(a.phase).toBe("done");
    expect(a.path).toEqual(b.path);
    expect(a.path).toEqual([a.start, ...warm.hierarchical(a.start, a.goal)!]);
    expect(a.path[0]).toBe(a.start);
    expect(a.path[a.path.length - 1]).toBe(a.goal);
    expect(phases.has("crossing")).toBe(true);
    expect(phases.has("validate")).toBe(true);
  });
  it("bounds interleaved corridor work and preserves publication after portable planner restore", async () => {
    const m = map(),
      resultA: any[] = [],
      resultB: any[] = [],
      ports = (out: any[]) => ({
        priority: () => true,
        valid: () => true,
        obstacleRevision: () => "0",
        blocked: () => undefined,
        completed: (r: any, o: any, p: any) => out.push([r.key, o, p]),
      });
    const a = new RoutePlanner(
      new LandPaths(m, false),
      new WaterPaths(m, false),
      ports(resultA),
    );
    for (let i = 0; i < 3; i++)
      a.request({
        key: String(i),
        start: m.ref(1, i + 1),
        goal: m.ref(175, 95 - i),
        water: false,
        createdTick: 0,
        obstacleRevision: "0",
        context: 0,
      });
    a.step(0, 1024, 17);
    const saved = await decodeState<ReturnType<typeof a.checkpoint>>(
      await encodeState(a.checkpoint()),
    );
    expect(saved.jobs.some((j) => j.corridor)).toBe(true);
    const b = new RoutePlanner(
      new LandPaths(m, false),
      new WaterPaths(m, false),
      ports(resultB),
    );
    b.restore(saved);
    for (let tick = 1; a.diagnostics.pending && tick < 1000; tick++)
      expect(a.step(tick, 1024, 17)).toBe(b.step(tick, 1024, 17));
    expect(resultA).toEqual(resultB);
    expect(resultA).toHaveLength(3);
    expect(a.diagnostics.workspaceUsed).toBe(0);
  });
  it("reclaims a cancelled corridor and rejects malformed continuation ownership", () => {
    const m = map(),
      planner = new RoutePlanner(
        new LandPaths(m, false),
        new WaterPaths(m, false),
        {
          priority: () => true,
          valid: () => true,
          obstacleRevision: () => "0",
          blocked: () => undefined,
          completed: () => {},
        },
      );
    planner.request({
      key: "x",
      start: 181,
      goal: 17000,
      water: false,
      createdTick: 0,
      obstacleRevision: "0",
      context: 0,
    });
    planner.step(0, 1024, 8);
    const saved = planner.checkpoint();
    if (saved.jobs[0]?.corridor) {
      saved.jobs[0].corridor.nodes = new Map();
      const invalid = new RoutePlanner(
        new LandPaths(m, false),
        new WaterPaths(m, false),
        {
          priority: () => true,
          valid: () => true,
          obstacleRevision: () => "0",
          blocked: () => undefined,
          completed: () => {},
        },
      );
      expect(() => invalid.restore(saved)).toThrow("own");
    }
    planner.cancel("x");
    for (let i = 0; planner.diagnostics.pending && i < 1000; i++)
      expect(planner.step(i, 13, 3)).toBeLessThanOrEqual(13);
    expect(planner.diagnostics.workspaceUsed).toBe(0);
  });
  it("reuses details across motion and invalidates clears, containers and identity reuse", () => {
    const game = new Skirmish(map(), {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      }),
      cache = new SquadDetailCache(),
      s = game.squads[0];
    const pack = () => packSnapshotDetails([s], [], [], [], cache);
    const first = pack();
    game.updateSquad(s.id, { x: s.x + 1 });
    expect(pack().strings).toEqual(first.strings);
    expect(cache.diagnostics.hits).toBe(1);
    const old = s.formation;
    game.updateSquad(s.id, {
      formation: old ? { ...old, facing: old.facing + 1 } : undefined,
    });
    expect(pack().strings).not.toEqual(first.strings);
    const cleared = {
      ...s,
      formation: undefined,
      manpower: undefined,
      stance: undefined,
      combatFact: undefined,
      occupancy: undefined,
      meleeStrike: undefined,
      chargeImpact: undefined,
      cavalryEngagement: undefined,
      cavalryMelee: undefined,
      charge: null,
    };
    expect(
      packSnapshotDetails([cleared], [], [], [], cache).squads![29],
    ).toBeNaN();
    cache.forget(s.id);
    pack();
    expect(cache.diagnostics.misses).toBe(3);
  });
  it("projects current tiles without copies while retaining independent snapshots and interpolation coordinates", () => {
    const game = new Skirmish(map(), {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      }),
      encoder = new SnapshotEncoder(),
      latest = new SnapshotDecoder(),
      copy = new SnapshotDecoder(),
      samples = new RenderSamples<any>();
    const full = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    const before = latest.decodeLatest(full),
      independent = copy.decode(full);
    samples.update(before.squads, game.tick, 0);
    const id = game.squads[0].id,
      oldX = game.squads[0].x,
      tile = game.tileOf(game.squads[0]);
    game.owners[tile] = 0;
    game.tileChanges.record(tile);
    game.updateSquad(id, { x: oldX + 20 });
    game.tick++;
    const packet = encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      ),
      after = latest.decodeLatest(packet),
      owned = copy.decode(packet);
    expect(after).toEqual(owned);
    expect(after.owners).toBe(before.owners);
    expect(independent.squads.find((s) => s.id === id)!.x).toBe(oldX);
    samples.update(after.squads, game.tick, 50);
    expect(samples.get(id)!.previousX).toBe(oldX);
    expect(samples.get(id)!.current.x).toBe(oldX + 20);
  });
});
