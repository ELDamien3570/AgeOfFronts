import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";

describe("resumable authoritative routes", () => {
  it("bounds cold and warm work including reconstruction, and saves mid-route deterministically", () => {
    const map = new GameMapImpl(
        180,
        100,
        new Uint8Array(18_000).fill(133),
        18_000,
      ),
      paths = new LandPaths(map, false);
    const start = map.ref(4, 4),
      goal = map.ref(175, 95),
      job = paths.begin(start, goal);
    expect(job.step(17, paths.revision)).toBeLessThanOrEqual(17);
    const restored = paths.begin(start, goal, job.checkpoint());
    while (job.state.phase !== "done") {
      expect(job.step(23, paths.revision)).toBe(
        restored.step(23, paths.revision),
      );
    }
    expect(restored.state).toEqual(job.state);
    paths.find(start, goal);
    const warm = paths.begin(start, goal);
    while (warm.state.phase !== "done") warm.step(23, paths.revision);
    expect(warm.state).toEqual(job.state);
  });
  it("rejects stale topology and never cuts a blocked diagonal", () => {
    const map = new GameMapImpl(32, 32, new Uint8Array(1024).fill(133), 1024),
      paths = new LandPaths(map);
    const job = paths.begin(map.ref(1, 1), map.ref(3, 3)),
      blocked = (tile: number) =>
        tile === map.ref(2, 1) || tile === map.ref(1, 2);
    while (job.state.phase !== "done") job.step(9, paths.revision, blocked);
    expect(job.state.path[0]).not.toBe(map.ref(2, 2));
    const stale = paths.begin(0, 30);
    expect(stale.step(10, paths.revision + 1)).toBe(0);
    expect(stale.state.phase).toBe("stale");
  });
  it("uses water connectivity and reports physical failure separately from pending work", () => {
    const data = new Uint8Array(1024).fill(133);
    for (let y = 12; y < 20; y++)
      for (let x = 0; x < 32; x++) data[y * 32 + x] = 0;
    const map = new GameMapImpl(32, 32, data, 768),
      paths = new WaterPaths(map),
      job = paths.begin(map.ref(1, 14), map.ref(30, 16));
    job.step(1, paths.revision);
    expect(job.state.phase).toBe("search");
    while (job.state.phase !== "done") job.step(7, paths.revision);
    expect(paths.begin(map.ref(1, 1), map.ref(30, 16)).state.phase).toBe(
      "unreachable",
    );
    expect(job.state.path.every((t) => map.isWater(t))).toBe(true);
  });
});
