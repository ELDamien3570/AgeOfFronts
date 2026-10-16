import { expect, it } from "vitest";
import { idleTickFixture } from "./fixtures/IdleTickFixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Roadmap Next #2, I-4 (P36): RoutePlanner.step pins shared preparation for
// every path family from one pass over the job table. Each call must receive
// exactly what the former per-family spread/filter/flatMap produced.
it("pins the same corridor origins per path family as the per-family scans", () => {
  const game = idleTickFixture(), sim = game as any, planner = sim.routePlanner;
  const families = [planner.land, planner.water, planner.amphibious].filter(Boolean);
  const legacy = (paths: unknown) => [...planner.jobs.values()].filter((job: any) => planner.pathsFor(job) === paths)
    .flatMap((job: any) => job.corridor?.local ? [job.corridor.local.origin] : []);
  let calls = 0, origins = 0;
  for (const paths of families) {
    const original = paths.pinSharedPreparation.bind(paths);
    paths.pinSharedPreparation = (received: Iterable<number>) => {
      const list = [...received];
      expect(list).toEqual(legacy(paths));
      calls++; origins += list.length;
      return original(list);
    };
  }
  for (let i = 0; i < 300; i++) game.step();
  expect(calls).toBeGreaterThanOrEqual(300 * families.length);
  expect(origins).toBeGreaterThan(0);
}, 120_000);
