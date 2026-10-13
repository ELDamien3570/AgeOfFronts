import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";
for (const obstructed of [false, true]) for (const policy of ["legacy", "shared"] as const) {
  const width = 1000, height = 160;
  const terrain = new Uint8Array(width * height);
  if (obstructed) for (let y = 0; y < height; y++) if (y !== 80) terrain[y * width + 500] = 133;
  const map = new GameMapImpl(width, height, terrain, width * height);
  const land = new LandPaths(map, false), water = new WaterPaths(map, false);
  const outcomes: Record<string, number> = {};
  let tick = 0, maximumWork = 0, maximumArena = 0;
  const latency: number[] = [], times: number[] = [];
  const planner = new RoutePlanner<{ playerId: number; caller: "trade" }>(land, water, {
    sharedPreparation: policy === "shared", lendIdlePreparation: true,
    priority: () => false, committed: () => true, corridorReady: () => true,
    identity: r => r.context, valid: () => true, obstacleRevision: () => "water",
    blocked: () => undefined, allowExclusiveRetry: () => false,
    completed: (_r, outcome) => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; if (outcome === "complete") latency.push(tick + 1); },
  });
  for (let i = 0; i < 120; i++) planner.request({ key: String(i), start: map.ref(1 + i % 30, 1 + i), goal: map.ref(970 + i % 30, 150 - i), water: true, obstacleRevision: "water", createdTick: 0, context: { playerId: i % 37 + 1, caller: "trade" } });
  const started = performance.now();
  for (; tick < 4000 && Object.values(outcomes).reduce((a,b) => a + b, 0) < 120; tick++) {
    const before = performance.now();
    maximumWork = Math.max(maximumWork, planner.step(tick));
    times.push(performance.now() - before);
    maximumArena = Math.max(maximumArena, planner.diagnostics.workspaceUsed);
  }
  latency.sort((a,b) => a-b); times.sort((a,b) => a-b);
  const percentile = (rows: number[], p: number) => rows[Math.min(rows.length - 1, Math.ceil(rows.length * p) - 1)] ?? null;
  console.log(JSON.stringify({ policy, scenario: obstructed ? "single-channel" : "open-water", requests: 120, factions: 37,
    tick, outcomes, pending: planner.diagnostics.pending, oldestAge: planner.diagnostics.oldestAge,
    latency: { p95Ticks: percentile(latency, .95), p99Ticks: percentile(latency, .99), maximumTicks: percentile(latency, 1) },
    maximumWork, maximumArena, routingP95Ms: percentile(times, .95), hierarchy: water.residency.hierarchy,
    ms: performance.now() - started }));
}
