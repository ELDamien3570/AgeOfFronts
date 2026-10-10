import { describe, expect, it } from "vitest";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import { migrationValleyRoute } from "../../src/skirmish/MigrationValleyRoute";

describe("Migration topography and waterways", () => {
  it("routes a mainland strait through a valley instead of crossing its ridge", () => {
    const size = 50,
      land = new Uint8Array(size * size),
      heights = new Float32Array(size * size);
    for (let y = 5; y < 45; y++)
      for (let x = 5; x < 45; x++) {
        land[y * size + x] = 1;
        heights[y * size + x] = x > 17 && x < 32 && y < 29 ? 750 : 40;
      }
    const route = migrationValleyRoute(
      size,
      land,
      heights,
      {
        id: 1,
        x: 25,
        y: 25,
        radiusX: 24,
        radiusY: 24,
        rotation: 0,
        phases: [],
        coves: [],
      },
      0,
      0,
      2,
    )!;
    expect(route).toBeDefined();
    const interior = route.points.filter((p) => p.x > 18 && p.x < 31);
    expect(interior.length).toBeGreaterThan(5);
    expect(interior.every((p) => p.y >= 29)).toBe(true);
  });
  it.each([250, 500, 1000])(
    "%i: descending river beds above sea level, tributaries, and substantial relief",
    (size) => {
      const map = generateMigration(size, 1313198008),
        heights = map.elevation!.values,
        rivers = map.layout.rivers.filter((r) => r.kind === "river");
      expect(rivers.length).toBeGreaterThan(0);
      let highest = 0,
        lowest = Infinity,
        shared = 0,
        mountains = 0,
        land = 0;
      const seen = new Set<number>();
      for (let tile = 0; tile < heights.length; tile++)
        if (map.map.isLand(tile)) {
          land++;
          mountains += Number(map.map.isImpassable(tile));
          highest = Math.max(highest, heights[tile]);
          lowest = Math.min(lowest, heights[tile]);
        }
      expect(highest - lowest).toBeGreaterThan(300);
      expect(mountains).toBeGreaterThan(0);
      expect(mountains / land).toBeLessThan(0.15);
      for (const river of rivers) {
        let previous = Infinity,
          previousWidth = 0;
        for (const p of river.points) {
          const tile = Math.floor(p.y) * size + Math.floor(p.x),
            h = heights[tile];
          expect(map.map.isWater(tile)).toBe(true);
          expect(h).toBeLessThanOrEqual(previous + 0.001);
          expect(p.width).toBeGreaterThanOrEqual(previousWidth);
          previous = h;
          previousWidth = p.width;
          if (seen.has(tile)) shared++;
          seen.add(tile);
        }
        const first = river.points[0];
        expect(
          heights[Math.floor(first.y) * size + Math.floor(first.x)],
        ).toBeGreaterThan(0);
        expect(previous).toBeLessThan(0);
      }
      if (size === 1000) expect(shared).toBeGreaterThan(0);
    },
    30000,
  );
});
