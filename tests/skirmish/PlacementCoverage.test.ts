import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PlacementCoverage } from "../../src/skirmish/client/PlacementCoverage";

const map = new GameMapImpl(20, 20, new Uint8Array(400).fill(133), 400);
const viewport = { left: 0, top: 0, right: 20, bottom: 20 };

describe("placement footprint coverage", () => {
  it("shows all nine occupied city cells without painting its reserved border", () => {
    const runs = new PlacementCoverage().runs(
      map,
      [map.ref(5, 6)],
      "city",
      viewport,
    );
    expect(runs).toEqual([6, 7, 8].map((y) => ({ y, left: 5, right: 8 })));
  });

  it("unions overlapping footprints once and preserves gaps between disconnected sites", () => {
    const runs = new PlacementCoverage().runs(
      map,
      [map.ref(2, 3), map.ref(3, 3), map.ref(12, 3)],
      "city",
      viewport,
    );
    expect(runs).toEqual(
      [3, 4, 5].flatMap((y) => [
        { y, left: 2, right: 6 },
        { y, left: 12, right: 15 },
      ]),
    );
  });

  it("retains the tall airstrip shape", () => {
    expect(
      new PlacementCoverage().runs(map, [map.ref(5, 6)], "airstrip", viewport),
    ).toEqual([6, 7, 8].map((y) => ({ y, left: 5, right: 7 })));
  });

  it("includes visible cells of offscreen anchors and clips at viewport and map edges", () => {
    const coverage = new PlacementCoverage();
    expect(
      coverage.runs(map, [map.ref(3, 3)], "city", {
        left: 5,
        top: 5,
        right: 10,
        bottom: 10,
      }),
    ).toEqual([5].map((y) => ({ y, left: 5, right: 6 })));
    expect(
      coverage.runs(map, [map.ref(18, 18)], "city", {
        left: 16,
        top: 16,
        right: 25,
        bottom: 25,
      }),
    ).toEqual([18, 19].map((y) => ({ y, left: 18, right: 20 })));
  });

  it("clears reused coverage when placements or the viewport change", () => {
    const coverage = new PlacementCoverage();
    coverage.runs(map, [map.ref(3, 3)], "city", viewport);
    expect(coverage.runs(map, [map.ref(10, 10)], "factory", viewport)).toEqual(
      [10, 11].map((y) => ({ y, left: 10, right: 12 })),
    );
    expect(coverage.runs(map, [], "city", viewport)).toEqual([]);
    expect(
      coverage.runs(map, [map.ref(3, 3)], "city", {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      }),
    ).toEqual([]);
  });
});
