import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { retainSquads } from "./UnitFixtures";
import { MovementAdmission } from "../../src/skirmish/MovementAdmission";

function fixture(water?: (x: number, y: number) => boolean) {
  const width = 100, height = 70, data = new Uint8Array(width * height).fill(133);
  if (water) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (water(x, y)) data[y * width + x] = 0;
  const map = new GameMapImpl(width, height, data, data.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true });
  return { match, map };
}
function humanSquads(match: Skirmish, count: number, x0: number, y0: number) {
  const template = match.squads.find(s => s.playerId === 1)!;
  return retainSquads(match, [...match.squads.filter(s => s.playerId !== 1), ...Array.from({ length: count }, (_, i) => ({
    ...template, id: match.allocateId(), x: Math.round((x0 + (i % 5) * 1.5) * FIXED), y: Math.round((y0 + Math.floor(i / 5) * 1.5) * FIXED),
    order: { type: "hold" as const }, path: [], queuedOrders: [],
  }))]).filter(s => s.playerId === 1);
}
function admissionRequests(match: Skirmish) {
  const request = vi.spyOn(match.routePlanner, "request");
  return () => request.mock.calls.filter(([r]) => r.key.startsWith("admission:")).length;
}

describe("human movement admission latency", () => {
  it("keeps finished routes when an unrelated wall changes the obstacle revision", () => {
    const run = (wall: boolean) => {
      const { match, map } = fixture(), squads = humanSquads(match, 10, 10.5, 10.5);
      const requests = admissionRequests(match);
      expect(match.applyCommand({ type: "order", playerId: 1, squadIds: squads.map(s => s.id), order: { type: "move", tile: map.ref(85, 60) } })).toBeNull();
      let tick = 0;
      for (; tick < 400 && !match.movementAdmission.checkpoint().pending.some(([, a]) => a.members.some(m => m.path)); tick++) match.step();
      const pending = match.movementAdmission.checkpoint().pending;
      expect(pending.length).toBeGreaterThan(0);
      if (wall) {
        const before = match.expansion!.fortifications.version;
        // An enemy wall on the far side of the map, nowhere near any route.
        match.expansion!.fortifications.addBarrier({ id: 9000, playerId: 2, age: "StoneAge", a: 1, b: 2,
          tiles: [map.ref(95, 2), map.ref(96, 2)], health: 100, maxHealth: 100, remainingTicks: 0 });
        expect(match.expansion!.fortifications.version).toBeGreaterThan(before);
      }
      for (; tick < 1000 && match.movementAdmission.pendingCount; tick++) match.step();
      expect(match.movementAdmission.pendingCount).toBe(0);
      expect(match.movementAdmission.events.some(e => e.playerId === 1 && e.status === "rejected")).toBe(false);
      return { tick, requests: requests(), paths: squads.map(s => match.squad(s.id)!.path) };
    };
    const control = run(false), walled = run(true);
    expect(walled.requests).toBe(control.requests);
    expect(walled.tick).toBe(control.tick);
    expect(walled.paths).toEqual(control.paths);
  });

  it("replans only the finished human routes that a new wall actually crosses", () => {
    const { match, map } = fixture(), [leader] = humanSquads(match, 1, 10.5, 30.5);
    const far = match.addSquad({ ...leader, id: match.allocateId(), x: Math.round(10.5 * FIXED), y: Math.round(66.5 * FIXED) });
    let revision = "0";
    const wall = new Set<number>(), requests: { squadId: number; start: number; goal: number }[] = [], commits: number[][] = [];
    const admission = new MovementAdmission(map, match.paths, {
      squads: () => match.squads, priority: () => true, squad: id => match.squad(id),
      generation: () => 0, revision: () => revision, blocked: () => wall.size ? tile => wall.has(tile) : undefined,
      request: (_id, _player, squadId, start, goal) => { requests.push({ squadId, start, goal }); return true; },
      cancel: () => {}, queue: () => {}, clear: () => true, destinationValid: () => true,
      commit: (_squad, _point, path) => { commits.push(path); },
    });
    const id = admission.start(1, [leader, far], map.ref(80, 31), 0);
    const straight = (from: number, to: number) => {
      const path = [from];
      while (path[path.length - 1] !== to) {
        const at = path[path.length - 1], x = map.x(at), y = map.y(at);
        path.push(map.ref(x + Math.sign(map.x(to) - x), y + Math.sign(map.y(to) - y)));
      }
      return path;
    };
    const routes = new Map<number, number[]>();
    for (let tick = 0; tick < 50 && routes.size < 2; tick++) {
      admission.step(tick, 128);
      for (const r of requests.splice(0)) {
        routes.set(r.squadId, straight(r.start, r.goal));
        admission.completed(id, r.squadId, "complete", routes.get(r.squadId)!, tick);
      }
    }
    expect([...routes.keys()].sort()).toEqual([leader.id, far.id].sort());
    expect(commits).toHaveLength(0);
    // Wall one cell of the leader's finished route that the other route avoids.
    const crossing = routes.get(leader.id)!.find(tile => map.x(tile) === 50)!;
    expect(routes.get(far.id)!.some(tile => Math.abs(map.x(tile) - 50) <= 1 && Math.abs(map.y(tile) - map.y(crossing)) <= 1)).toBe(false);
    wall.add(crossing);
    revision = "1";
    for (let tick = 50; tick < 100 && !requests.length && !commits.length; tick++) admission.step(tick, 128);
    // Only the crossed member re-requests; nothing commits through the wall.
    expect(commits).toHaveLength(0);
    expect(requests.map(r => r.squadId)).toEqual([leader.id]);
  });

  it("rejects a unit wedged against water instead of replanning it every tick", () => {
    const { match, map } = fixture((x, y) => x < 20 && y < 20);
    const [squad] = humanSquads(match, 1, 20, 20);
    // Exactly on the water corner: the squad's radius overlaps a water tile.
    match.updateSquad(squad.id, { x: 20 * FIXED, y: 20 * FIXED });
    const requests = admissionRequests(match);
    expect(match.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: map.ref(70, 50) } })).toBeNull();
    for (let tick = 0; tick < 300 && match.movementAdmission.pendingCount; tick++) match.step();
    expect(match.movementAdmission.pendingCount).toBe(0);
    expect(match.movementAdmission.events.slice(-1)[0]).toMatchObject({ status: "rejected", reason: expect.stringContaining("wedged") });
    expect(requests()).toBeLessThanOrEqual(5);
  });
});
