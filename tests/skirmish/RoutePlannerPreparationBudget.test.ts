import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";

it("charges cold shared local-tree dequeues to the planner budget and restores partial blocks exactly", () => {
  const map = new GameMapImpl(400, 96, new Uint8Array(38400), 0);
  const make = () => new RoutePlanner(new LandPaths(map, false), new WaterPaths(map, false), {
    balancedActiveAdmission: true, lendIdlePreparation: true,
    priority: () => false, committed: () => true, corridorReady: () => true,
    valid: () => true, obstacleRevision: () => "0", blocked: () => () => false, completed: () => {},
  });
  const planner = make();
  for (let id = 0; id < 8; id++) planner.request({key: `sea:${id}`, start: map.ref(2, 3 + id),
    goal: map.ref(397, 90 - id), water: true, createdTick: 0, obstacleRevision: "0", context: null});
  let observedPartial = false, dequeues = 0;
  for (let tick = 0; tick < 8; tick++) {
    const before = planner.checkpoint();
    const used = planner.step(tick * 2, 2048, 64), saved = planner.checkpoint();
    const effort = (state: typeof saved) => state.sharedPreparation!.water!.entries.reduce((n, row) => n + row.tree.effort, 0);
    const delta = effort(saved) - effort(before); dequeues += delta;
    expect(delta).toBeLessThanOrEqual(used);
    expect(used).toBeLessThanOrEqual(2048);
    observedPartial ||= saved.sharedPreparation!.water!.entries.some(row => row.heap && row.tree.effort % 512 !== 0);
    const restored = make(); restored.restore(saved);
    expect(restored.checkpoint()).toEqual(saved);
    expect(restored.step(tick * 2 + 1, 17, 7)).toBe(planner.step(tick * 2 + 1, 17, 7));
    expect(restored.checkpoint()).toEqual(planner.checkpoint());
  }
  expect(dequeues).toBeGreaterThan(1000);
  expect(observedPartial).toBe(true);
});
