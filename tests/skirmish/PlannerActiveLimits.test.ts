import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";

/** Scheduling v6: background corridors (held by the shared per-tick
 * crossing-tree preparation allowance) and background exact searches (held
 * by arena work) have separate active limits, so cold corridors cannot starve
 * every exact background search (Mig 500: AI admissions behind trade). */
interface Context { corridor: boolean }
function fixture(version?: 5) {
  const W = 400, H = 60, map = new GameMapImpl(W, H, new Uint8Array(W * H).fill(133), W * H);
  const done = new Map<string, number>();
  let tick = 0;
  const planner = new RoutePlanner<Context>(new LandPaths(map, false), new WaterPaths(map, false), {
    priority: () => false, corridorReady: (r) => r.context.corridor,
    valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
    completed: (r, outcome) => { if (outcome === "complete") done.set(r.key, tick); },
  });
  if (version) planner.restore({ ...planner.checkpoint(), scheduling: { ...planner.checkpoint().scheduling, version } });
  const request = (key: string, corridor: boolean, y: number) => planner.request({
    key, start: map.ref(2, y), goal: map.ref(W - 3, (y * 7) % H), water: false, createdTick: 0, obstacleRevision: "0", context: { corridor },
  });
  const step = () => { planner.step(tick, 4096); tick++; };
  return { planner, request, step, done, now: () => tick };
}

/** Ticks at which the exact search and the first corridor completed. */
function race(version?: 5) {
  const f = fixture(version);
  for (let i = 0; i < 16; i++) expect(f.request(`corridor:${i}`, true, 2 + i * 3)).toBe(true);
  for (let i = 0; i < 3; i++) f.step();
  expect(f.request("exact", false, 30)).toBe(true);
  for (let i = 0; i < 400 && f.done.size < 17; i++) f.step();
  expect(f.done.size).toBe(17);
  return { exact: f.done.get("exact")!, firstCorridor: Math.min(...[...f.done].filter(([k]) => k !== "exact").map(([, t]) => t)) };
}

describe("planner active limits (scheduling v6)", () => {
  it("runs an exact background search while 16 cold corridors prepare", () => {
    const v6 = race();
    expect(v6.exact).toBeLessThan(v6.firstCorridor);
  });
  it("version 5 checkpoints keep one shared limit (the exact search waits for a corridor)", () => {
    const v5 = race(5);
    expect(v5.exact).toBeGreaterThanOrEqual(v5.firstCorridor);
  });
});
