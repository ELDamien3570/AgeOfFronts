import { describe, expect, it } from "vitest";
import { TerrainType } from "../../src/core/game/Game";
import { generateMigration } from "../../src/skirmish/MigrationMap";
import { formTerrain } from "../../src/skirmish/TerrainFormation";

const recipe = {
  resolution: 100,
  erosionPasses: 4,
  streamPower: 38,
  spurHeight: 0.28,
};
function fixture() {
  const size = 100,
    land = new Uint8Array(size * size),
    heights = new Float32Array(size * size),
    shore = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x,
        d = Math.min(x, y, size - 1 - x, size - 1 - y);
      land[tile] = Number(d > 2);
      shore[tile] = Math.max(0, d - 2);
      heights[tile] = land[tile] ? 50 + d * 30 + Math.sin(x * 0.4) * 60 : -100;
    }
  return { size, land, heights, shore };
}
describe("landscape formation", () => {
  it("incises connected runoff valleys without filling basins or changing the coastline", () => {
    const a = fixture(),
      original = a.heights.slice(),
      mask = a.land.slice(),
      b = fixture();
    formTerrain(a.size, a.land, a.heights, a.shore, [], 42, {
      ...recipe,
      spurHeight: 0,
    });
    formTerrain(b.size, b.land, b.heights, b.shore, [], 42, {
      ...recipe,
      spurHeight: 0,
    });
    expect(a.heights).toEqual(b.heights);
    expect(a.land).toEqual(mask);
    let incised = 0,
      retained = 0;
    for (let tile = 0; tile < a.heights.length; tile++) {
      expect(Number.isFinite(a.heights[tile])).toBe(true);
      if (!mask[tile]) expect(a.heights[tile]).toBe(original[tile]);
      else {
        expect(a.heights[tile]).toBeGreaterThan(0);
        incised += Number(original[tile] - a.heights[tile] > 25);
        retained += Number(original[tile] - a.heights[tile] < 15);
      }
    }
    expect(incised).toBeGreaterThan(100);
    expect(retained).toBeGreaterThan(100);
  });
  it("generates traversable hills and preserves passable outer islands at each size", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = generateMigration(size, 614546621),
        counts = new Map<TerrainType, number>();
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const type = loaded.map.terrainType(tile);
        counts.set(type, (counts.get(type) ?? 0) + 1);
        if (loaded.layout.regions[tile] > loaded.layout.mainlands.length)
          expect(loaded.map.isImpassable(tile)).toBe(false);
      }
      expect(counts.get(TerrainType.Plains)).toBeGreaterThan(500);
      expect(counts.get(TerrainType.Highland)).toBeGreaterThan(100);
      expect(counts.get(TerrainType.Mountain)).toBeGreaterThan(10);
      expect(loaded.elevation!.reliefScale).toBe((5 * size) / 1000);
    }
  }, 30000);
  it("rejects invalid generation budgets", () => {
    const f = fixture();
    expect(() =>
      formTerrain(f.size, f.land, f.heights, f.shore, [], 0, {
        ...recipe,
        erosionPasses: 100,
      }),
    ).toThrow();
  });
});
