import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";
for (const lendIdlePreparation of [false, true]) {
  const width = 1000, height = 160;
  const map = new GameMapImpl(width, height, new Uint8Array(width * height), width * height);
  const land = new LandPaths(map, false), water = new WaterPaths(map, false);
  const outcomes: Record<string, number> = {};
  const planner = new RoutePlanner<{ playerId: number; caller: "trade" }>(land, water, {
    lendIdlePreparation, priority: () => false, corridorReady: () => true,
    identity: r => r.context, valid: () => true, obstacleRevision: () => "water",
    blocked: () => undefined, allowExclusiveRetry: () => false,
    completed: (_r, outcome) => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; },
  });
  for (let i = 0; i < 120; i++) planner.request({ key: String(i), start: map.ref(1 + i % 30, 1 + i), goal: map.ref(970 + i % 30, 150 - i), water: true, obstacleRevision: "water", createdTick: 0, context: { playerId: i % 37 + 1, caller: "trade" } });
  const started = performance.now(); let tick = 0;
  for (; tick < 4000 && Object.values(outcomes).reduce((a,b) => a + b, 0) < 120; tick++) planner.step(tick);
  console.log(JSON.stringify({ lendIdlePreparation, tick, outcomes, pending: planner.diagnostics.pending, oldestAge: planner.diagnostics.oldestAge, ms: performance.now() - started }));
}
