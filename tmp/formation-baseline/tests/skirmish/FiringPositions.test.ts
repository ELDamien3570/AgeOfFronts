import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FiringPositions } from "../../src/skirmish/FiringPositions";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED } from "../../src/skirmish/Protocol";

describe("bounded firing-position finalists", () => {
  it("bounds both cell and LOS work and resumes sampling from its exact checkpoint", () => {
    const map = new GameMapImpl(64, 64, new Uint8Array(4096).fill(133), 4096),
      paths = new LandPaths(map),
      target = { x: 32 * FIXED, y: 32 * FIXED },
      job = new FiringPositions(
        map,
        paths,
        map.ref(5, 5),
        "archer",
        target,
        6 * FIXED,
      );
    const clear = () => true;
    const initial = job.step(100, 3, undefined, clear);
    expect(initial.work).toBeLessThanOrEqual(100);
    expect(initial.rays).toBe(3);
    const clone = new FiringPositions(
      map,
      paths,
      map.ref(5, 5),
      "archer",
      target,
      6 * FIXED,
      structuredClone(job.state),
    );
    while (!job.state.done) {
      expect(clone.step(47, 3, undefined, clear)).toEqual(
        job.step(47, 3, undefined, clear),
      );
      expect(clone.state).toEqual(job.state);
    }
    expect(job.state.candidates.length).toBe(32);
    expect(
      job.state.candidates.every((c) => {
        const x = (map.x(c.tile) + 0.5) * FIXED,
          y = (map.y(c.tile) + 0.5) * FIXED;
        return (x - target.x) ** 2 + (y - target.y) ** 2 <= (6 * FIXED) ** 2;
      }),
    ).toBe(true);
  });
});
