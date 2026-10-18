import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";

// Roadmap Next #2, I-4 (P36): RoutePlanner.step pins shared preparation for
// every path family from one pass over the job table. Each call must receive
// exactly what the former per-family spread/filter/flatMap produced.
it("pins the same corridor origins per path family as the per-family scans", () => {
  const width = 192, height = 128, terrain = new Uint8Array(width * height).fill(133);
  for (let y = 0; y < height; y++) terrain.fill(0, y * width + 96, (y + 1) * width);
  const map = new GameMapImpl(width, height, terrain, width * height);
  const land = new LandPaths(map, false), water = new WaterPaths(map, false),
    amphibious = new LandPaths(map, false, "amphibious");
  const completed: string[] = [];
  const routes = new RoutePlanner<number>(land, water, {
    priority: () => true, valid: () => true, obstacleRevision: () => "0",
    // An empty dynamic access mask keeps water on the ordinary corridor path
    // rather than the separate certified-water shortcut under test elsewhere.
    blocked: () => () => false,
    completed: (request, outcome, path) => {
      expect(outcome).toBe("complete");
      expect(path[path.length - 1]).toBe(request.goal);
      completed.push(request.key);
    },
  }, 128, 65_536, amphibious);
  const planner = routes as any, families = [land, water, amphibious];
  // Interleave families and keep two land origins to exercise grouping and
  // insertion order. Each continuation is produced by real corridor work;
  // none depends on which autonomous moves the economy happens to schedule.
  for (const request of [
    {key: "land-a", start: map.ref(1, 1), goal: map.ref(80, 120), water: false},
    {key: "water", start: map.ref(110, 1), goal: map.ref(180, 120), water: true},
    {key: "land-b", start: map.ref(5, 5), goal: map.ref(85, 110), water: false},
    {key: "amphibious", start: map.ref(2, 20), goal: map.ref(180, 100), water: false, amphibious: true},
  ]) {
    expect(routes.request({...request, createdTick: 0, obstacleRevision: "0", context: 1})).toBe(true);
    const job = planner.jobs.get(request.key), paths = planner.pathsFor(job);
    job.corridor = paths.beginCorridor(job.start, job.goal, job.search.nodes);
    expect(job.corridor).toBeDefined();
    job.corridorTried = true;
    expect(paths.stepCorridor(job.corridor, planner.workspace, 1)).toBe(1);
    expect(job.corridor.local?.origin).toBe(request.start);
  }
  const legacy = (paths: unknown) => [...planner.jobs.values()].filter((job: any) => planner.pathsFor(job) === paths)
    .flatMap((job: any) => job.corridor?.local ? [job.corridor.local.origin] : []);
  let calls = 0;
  const origins = new Map(families.map(paths => [paths, 0]));
  for (const paths of families) {
    const original = paths.pinSharedPreparation.bind(paths);
    paths.pinSharedPreparation = (received: Iterable<number>) => {
      const list = [...received];
      expect(list).toEqual(legacy(paths));
      calls++;
      origins.set(paths, origins.get(paths)! + list.length);
      return original(list);
    };
  }
  for (let i = 0; i < 300; i++) routes.step(i, 128, 8);
  expect(calls).toBeGreaterThanOrEqual(300 * families.length);
  for (const paths of families) expect(origins.get(paths)).toBeGreaterThan(0);
  expect(completed.sort()).toEqual(["amphibious", "land-a", "land-b", "water"]);
}, 120_000);
