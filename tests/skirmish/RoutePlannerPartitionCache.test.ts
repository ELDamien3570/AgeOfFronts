import {expect, it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {LandPaths, WaterPaths} from "../../src/skirmish/Pathfinding";
import {RoutePlanner, type ExactRouteOutcome} from "../../src/skirmish/RoutePlanner";
interface Context {playerId: number; caller: "admission" | "navigation" | "trade"}
function fixture(cached: boolean) {
  const map = new GameMapImpl(180, 100, new Uint8Array(18000).fill(133), 18000);
  const state = {epoch: 0, reads: 0, humans: new Set([1]), paid: new Set<string>()};
  const outcomes: {key: string; outcome: ExactRouteOutcome; path: number[]}[] = [];
  const planner = new RoutePlanner<Context>(new LandPaths(map, false), new WaterPaths(map, false), {
    balancedActiveAdmission: true, classificationRevision: () => {state.reads++; return state.epoch;},
    ...(cached ? {partitionRevision: () => state.epoch} : {}),
    priority: r => state.humans.has(r.context.playerId), committed: r => state.paid.has(r.key),
    identity: r => ({playerId: r.context.playerId, caller: r.context.caller}), corridorReady: () => false,
    valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
    deadlineTicks: r => state.humans.has(r.context.playerId) ? undefined : 8,
    completed: (r, outcome, path) => outcomes.push({key: r.key, outcome, path}),
  }, 128, 512);
  const request = (key: string, playerId = 2, water = false, caller: Context["caller"] = "trade", tick = 0) => ({
    key, start: 181, goal: 14000, water, createdTick: tick, obstacleRevision: "0", context: {playerId, caller},
  });
  return {planner, request, state, outcomes};
}

it("makes repeated refusals cheap while matching uncached admission, replacement, cancellation, epochs, expiry and restore", () => {
  const cached = fixture(true), reference = fixture(false);
  const request = (...args: Parameters<typeof cached.request>) => {
    const a = cached.planner.request(cached.request(...args)), b = reference.planner.request(reference.request(...args));
    expect(a).toBe(b); return a;
  };
  const same = () => {
    expect(cached.planner.checkpoint()).toEqual(reference.planner.checkpoint());
    expect(cached.outcomes).toEqual(reference.outcomes);
  };
  for (let id = 0; id < 104; id++) expect(request(`bg:${id}`)).toBe(true);
  cached.state.reads = reference.state.reads = 0;
  for (let id = 0; id < 200; id++) expect(request(`refused:${id}`)).toBe(false);
  expect(cached.state.reads * 10).toBeLessThan(reference.state.reads);
  same();
  for (const f of [cached, reference]) f.planner.cancel("bg:0");
  expect(request("replacement-slot")).toBe(true); same();
  expect(request("bg:1", 1, false, "admission")).toBe(true); same();
  for (let id = 0; id < 16; id++) request(`sea:${id}`, 3, true);
  same();
  for (const f of [cached, reference]) {f.state.paid.add("bg:3"); f.state.epoch++;}
  request("paid-epoch"); same();
  for (let id = 0; id < 16; id++) {
    for (const f of [cached, reference]) {f.state.paid.add(`paid-sea:${id}`); f.state.epoch++;}
    request(`paid-sea:${id}`, 3, true);
  }
  same();
  for (const f of [cached, reference]) {f.state.humans.add(2); f.state.epoch++;}
  request("new-human", 2, false, "navigation"); same();
  for (let tick = 1; tick < 12; tick++) {
    if (tick === 4) for (const f of [cached, reference]) {f.state.humans.delete(2); f.state.epoch++;}
    expect(cached.planner.step(tick, 64, 4)).toBe(reference.planner.step(tick, 64, 4)); same();
    request(`tick:${tick}`, tick % 3 + 1, tick % 2 === 0, "admission", tick); same();
    if (tick === 6) for (const f of [cached, reference]) f.planner.restore(f.planner.checkpoint());
  }
  same();
});


it("refreshes per-tick commitment facts so a live pressured queue agrees with its restored copy", () => {
  const live = fixture(true);
  for (let id = 0; id < 104; id++) expect(live.planner.request(live.request(`bg:${id}`))).toBe(true);
  expect(live.planner.request(live.request("refused"))).toBe(false);
  // A shipment can load between planner phases without changing the faction's
  // control epoch. Both the cached counts and their underlying weak facts
  // must refresh at the next planner tick.
  live.state.paid.add("bg:0"); live.planner.step(1, 0);
  const restored = fixture(true); restored.state.paid.add("bg:0"); restored.planner.restore(live.planner.checkpoint());
  const next = live.request("now-eligible", 2, false, "trade", 1);
  expect(live.planner.request(next)).toBe(true);
  expect(restored.planner.request(next)).toBe(true);
  expect(live.planner.checkpoint()).toEqual(restored.planner.checkpoint());
});
