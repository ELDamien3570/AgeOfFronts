import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner, type ExactRouteOutcome, type ExactRouteRequest } from "../../src/skirmish/RoutePlanner";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";

type Context = { playerId: number; caller: "trade" | "navigation"; loaded: boolean; human?: boolean };
function fixture(legacy = false, obstructed = false) {
  const width = 1000, height = 160;
  const terrain = new Uint8Array(width * height);
  if (obstructed) for (let y = 0; y < height; y++) if (y !== 80) terrain[y * width + 500] = 133;
  const map = new GameMapImpl(width, height, terrain, width * height);
  const land = new LandPaths(map, false), water = new WaterPaths(map, false);
  const results: { key: string; outcome: ExactRouteOutcome; path: number[] }[] = [];
  const ports = { sharedPreparation: !legacy, lendIdlePreparation: true,
    priority: (r: ExactRouteRequest<Context>) => !!r.context.human,
    committed: (r: ExactRouteRequest<Context>) => r.context.loaded,
    identity: (r: ExactRouteRequest<Context>) => r.context,
    corridorReady: () => true, valid: () => true, obstacleRevision: () => "water",
    blocked: () => undefined, allowExclusiveRetry: () => false,
    completed: (r: ExactRouteRequest<Context>, outcome: ExactRouteOutcome, path: number[]) => results.push({ key: r.key, outcome, path }),
  };
  const planner = new RoutePlanner(land, water, ports);
  const request = (key: string, i = 0, loaded = true, human = false) => planner.request({
    key, start: map.ref(1 + i % 30, 1 + i % 120), goal: map.ref(970 + i % 30, 150 - i % 120),
    water: true, createdTick: 0, obstacleRevision: "water",
    context: { playerId: i % 37 + 1, caller: human ? "navigation" : "trade", loaded, human },
  });
  return { map, land, water, ports, results, planner, request };
}

describe("shared trade routing", () => {
  it("shares canonical preparation despite physical cache warmth and survives subscriber cancellation", () => {
    const a = fixture(false, true), b = fixture(false, true); b.water.prepare();
    for (const f of [a, b]) {
      f.request("a"); f.request("b"); f.planner.step(0);
      f.planner.cancel("a");
      for (let tick = 1; tick < 100 && !f.results.some(r => r.key === "b"); tick++) f.planner.step(tick);
      expect(f.results.find(r => r.key === "b")?.outcome).toBe("complete");
      const origins = f.planner.checkpoint().sharedPreparation!.water!.entries.map(e => e.origin);
      expect(new Set(origins).size).toBe(origins.length);
      expect(origins.length).toBeLessThanOrEqual(1024);
    }
    expect(a.results).toEqual(b.results);
    expect(isDeepStrictEqual(a.planner.checkpoint(), b.planner.checkpoint())).toBe(true);
  });

  it("continues in-progress shared heaps identically after portable cold restore", async () => {
    const a = fixture(false, true), b = fixture(false, true);
    for (let i = 0; i < 8; i++) a.request(String(i), i);
    let tick = 0;
    for (; tick < 20; tick++) {
      a.planner.step(tick);
      if (a.planner.checkpoint().sharedPreparation!.water!.entries.some(e => e.heap)) break;
    }
    const saved = a.planner.checkpoint();
    expect(saved.sharedPreparation!.water!.entries.some(e => e.heap)).toBe(true);
    const portable = await decodeState<ReturnType<typeof a.planner.checkpoint>>(await encodeState(saved));
    b.planner.restore(portable);
    expect(isDeepStrictEqual(a.planner.checkpoint(), b.planner.checkpoint())).toBe(true);
    for (tick++; tick < 200 && (a.planner.diagnostics.pending || b.planner.diagnostics.pending); tick++) {
      expect(a.planner.step(tick)).toBe(b.planner.step(tick));
      expect(isDeepStrictEqual(a.planner.checkpoint(), b.planner.checkpoint())).toBe(true);
    }
    expect(a.results).toEqual(b.results);
    expect(a.results).toHaveLength(8);
  });

  it("rejects malformed shared ownership state and restores legacy scheduling explicitly", () => {
    const f = fixture(false, true); f.request("a");
    for (let tick = 0; tick < 20 && !f.planner.checkpoint().sharedPreparation!.water!.entries.length; tick++) f.planner.step(tick);
    const saved = f.planner.checkpoint();
    saved.sharedPreparation!.water!.entries.push(saved.sharedPreparation!.water!.entries[0]);
    expect(() => fixture(false, true).planner.restore(saved)).toThrow("Invalid shared preparation entry");
    const old = fixture(true); old.request("legacy"); old.planner.step(0);
    const cold = fixture(); cold.planner.restore(old.planner.checkpoint());
    expect(cold.planner.checkpoint().scheduling.version).toBe(3);
    expect(cold.planner.checkpoint().sharedPreparation).toBeUndefined();
  });
  it("bounds and deterministically evicts idle shared origins", () => {
    const map = new GameMapImpl(160, 120, new Uint8Array(19200).fill(133), 19200);
    const land = new LandPaths(map, false); let completed = 0;
    const planner = new RoutePlanner<number>(land, new WaterPaths(map, false), {
      lendIdlePreparation: true, corridorReady: () => true, valid: () => true,
      obstacleRevision: () => "0", blocked: () => undefined,
      completed: (_r, outcome) => { expect(outcome).toBe("complete"); completed++; },
    });
    let tick = 0;
    for (let i = 0; i < 1100; i++) {
      const start = map.ref(i % 30, Math.floor(i / 30));
      expect(planner.request({ key: String(i), start, goal: start + 1, water: false,
        createdTick: tick, obstacleRevision: "0", context: 0 })).toBe(true);
      for (let turn = 0; turn < 20 && completed <= i; turn++) planner.step(tick++);
      expect(completed).toBe(i + 1);
    }
    const saved = planner.checkpoint();
    expect(saved.sharedPreparation!.land!.entries).toHaveLength(1024);
    const cold = new RoutePlanner( new LandPaths(map, false), new WaterPaths(map, false), {
      valid: () => true, obstacleRevision: () => "0", blocked: () => undefined, completed: () => {},
    });
    cold.restore(saved);
    expect(isDeepStrictEqual(planner.checkpoint(), cold.checkpoint())).toBe(true);
  });
  it("restores a partly copied certified route with its exact next work step", () => {
    const a = fixture(), b = fixture(); a.request("ship"); a.planner.step(0, 17, 17);
    const saved = a.planner.checkpoint();
    expect(saved.jobs[0].shortcut!.path.length).toBe(18);
    const invalid = structuredClone(saved);
    invalid.jobs[0].shortcut!.path[1] = invalid.jobs[0].shortcut!.path[0];
    expect(() => fixture().planner.restore(invalid)).toThrow("Invalid certified water shortcut");
    b.planner.restore(saved);
    for (let tick = 1; tick < 100 && a.planner.diagnostics.pending; tick++)
      expect(a.planner.step(tick, 17, 17)).toBe(b.planner.step(tick, 17, 17));
    expect(a.results).toEqual(b.results);
    expect(isDeepStrictEqual(a.planner.checkpoint(), b.planner.checkpoint())).toBe(true);
  });

  it("completes a saturated distinct-route fleet without exhausting the arena", () => {
    const f = fixture();
    for (let i = 0; i < 120; i++) expect(f.request(String(i), i)).toBe(true);
    for (let tick = 0; tick < 200 && f.results.length < 120; tick++) {
      expect(f.planner.step(tick)).toBeLessThanOrEqual(4096);
      expect(f.planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(65536);
    }
    expect(f.results).toHaveLength(120);
    expect(f.results.every(r => r.outcome === "complete")).toBe(true);
    for (const result of f.results) {
      expect(f.water.connected(result.path[0], result.path[result.path.length - 1])).toBe(true);
      for (let i = 1; i < result.path.length; i++)
        expect(f.map.manhattanDist(result.path[i - 1], result.path[i])).toBe(1);
    }
  });

  it("respects a dynamic water mask introduced during certified copying", () => {
    const map = new GameMapImpl(30, 30, new Uint8Array(900), 900);
    let masked = false;
    const blocked = (tile: number) => map.x(tile) === 15 && map.y(tile) !== 10;
    const results: number[][] = [];
    const planner = new RoutePlanner<number>(new LandPaths(map, false), new WaterPaths(map, false), {
      valid: () => true, obstacleRevision: () => masked ? "1" : "0",
      blocked: () => masked ? blocked : undefined,
      completed: (_r, outcome, path) => { expect(outcome).toBe("complete"); results.push(path); },
    });
    planner.request({ key: "ship", start: map.ref(2, 2), goal: map.ref(27, 2), water: true,
      createdTick: 0, obstacleRevision: "0", context: 0 });
    planner.step(0, 5, 5);
    expect(planner.checkpoint().jobs[0].shortcut).toBeDefined();
    masked = true;
    for (let tick = 1; tick < 100 && !results.length; tick++) planner.step(tick);
    expect(results).toHaveLength(1);
    expect(results[0].some(blocked)).toBe(false);
  });

  it("clears a cold narrow-channel fleet within the measured 102-tick routing bound", () => {
    const f = fixture(false, true);
    for (let i = 0; i < 120; i++) expect(f.request(String(i), i)).toBe(true);
    for (let tick = 0; tick < 102 && f.results.length < 120; tick++) {
      expect(f.planner.step(tick)).toBeLessThanOrEqual(4096);
      expect(f.planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(65536);
    }
    expect(f.results).toHaveLength(120);
    for (const result of f.results) {
      expect(result.outcome).toBe("complete");
      for (let i = 1; i < result.path.length; i++) {
        expect(f.water.walkable(result.path[i])).toBe(true);
        expect(f.map.manhattanDist(result.path[i - 1], result.path[i])).toBe(1);
      }
    }
  });

  it("reserves admission for loaded cargo and makes progress alongside continuous human work", () => {
    const f = fixture();
    for (let i = 0; i < 104; i++) expect(f.request(`empty${i}`, i, false)).toBe(true);
    expect(f.request("excess-empty", 110, false)).toBe(false);
    expect(f.request("prize", 115, true)).toBe(true);
    for (let tick = 0; tick < 500 && !f.results.some(r => r.key === "prize"); tick++) {
      f.request(`human${tick}`, tick, false, true);
      expect(f.planner.step(tick)).toBeLessThanOrEqual(4096);
    }
    expect(f.results.find(r => r.key === "prize")?.outcome).toBe("complete");
    expect(f.results.some(r => r.key.startsWith("human") && r.outcome === "complete")).toBe(true);
  });
  it("invalidates only touched preparation epochs when forest costs change", () => {
    const width = 200, height = 100;
    const map = createSkirmishMap(width, height, new Uint8Array(width * height).fill(133), undefined,
      { cover: new Uint8Array(width * height).fill(255) });
    const land = new LandPaths(map, false), water = new WaterPaths(map, false);
    const results: number[][] = [];
    const planner = new RoutePlanner<number>(land, water, {
      lendIdlePreparation: true, corridorReady: () => true, valid: () => true,
      obstacleRevision: () => "0", blocked: () => undefined,
      completed: (_r, outcome, path) => { expect(outcome).toBe("complete"); results.push(path); },
    });
    const request = (key: string) => planner.request({ key, start: map.ref(2, 2), goal: map.ref(195, 95),
      water: false, obstacleRevision: "0", createdTick: 0, context: 1 });
    request("before");
    for (let tick = 0; tick < 100 && results.length < 1; tick++) planner.step(tick);
    const before = planner.checkpoint().sharedPreparation!.land!;
    forestOf(map)!.occupy(map, map.ref(2, 2), "city");
    request("after");
    for (let tick = 100; tick < 200 && results.length < 2; tick++) planner.step(tick);
    expect(results).toHaveLength(2);
    const after = planner.checkpoint().sharedPreparation!.land!;
    expect(after.entries.find(e => e.origin === map.ref(2, 2))!.revision).toBeGreaterThan(
      before.entries.find(e => e.origin === map.ref(2, 2))!.revision);
    expect(after.clusterRevisions.filter((v, i) => v !== before.clusterRevisions[i]).length).toBe(1);
  });
});
