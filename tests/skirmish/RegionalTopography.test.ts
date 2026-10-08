import { expect, it } from "vitest";
import { MIGRATION_THEME } from "../../src/skirmish/content/Migration";
import { carveMigrationDrainage } from "../../src/skirmish/MigrationHydrology";
import { createRegionalTopography } from "../../src/skirmish/RegionalTopography";
import { erodeTerrainSlopes } from "../../src/skirmish/TerrainErosion";

it("combines all regional landforms in each world and varies their geography between seeds", () => {
  const worlds = new Set<string>();
  for (let seed = 0; seed < 8; seed++) {
    const a = createRegionalTopography(250, seed, MIGRATION_THEME.topography),
      b = createRegionalTopography(1000, seed, MIGRATION_THEME.topography);
    expect(a.features).toEqual(b.features);
    expect(new Set(a.features.map((f) => f.kind))).toEqual(
      new Set(["range", "massif", "plateau", "plain", "basin"]),
    );
    worlds.add(JSON.stringify(a.features));
    let low = Infinity,
      high = 0;
    for (let y = 60; y < 190; y += 3)
      for (let x = 60; x < 190; x += 3) {
        const height = a.heightAt(x + 0.5, y + 0.5, 40);
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBeGreaterThan(0);
        expect(height).toBeLessThanOrEqual(5800);
        low = Math.min(low, height);
        high = Math.max(high, height);
      }
    expect(high - low).toBeGreaterThan(1000);
    expect(low).toBeLessThan(400);
  }
  expect(worlds.size).toBe(8);
});
it("thermal erosion transports material without changing land volume or water", () => {
  const size = 9,
    land = new Uint8Array(81),
    heights = new Float32Array(81).fill(-500);
  for (let y = 2; y < 7; y++)
    for (let x = 2; x < 7; x++) {
      land[y * size + x] = 1;
      heights[y * size + x] = 40;
    }
  heights[40] = 1800;
  const before = heights.slice(),
    total = (values: Float32Array) =>
      values.reduce((sum, h, tile) => sum + (land[tile] ? h : 0), 0);
  erodeTerrainSlopes(size, land, heights, {
    iterations: 12,
    talus: 2,
    rate: 0.1,
  });
  expect(heights[40]).toBeLessThan(before[40]);
  expect(total(heights)).toBeCloseTo(total(before), 2);
  for (let tile = 0; tile < 81; tile++)
    if (!land[tile]) expect(heights[tile]).toBe(-500);
});
it("cuts drainage outlets without filling whole lowland basins", () => {
  const size = 80,
    land = new Uint8Array(size * size),
    heights = new Float32Array(size * size).fill(-50);
  for (let y = 8; y < 72; y++)
    for (let x = 8; x < 72; x++) {
      land[y * size + x] = 1;
      const r = Math.hypot(x - 40, y - 40);
      heights[y * size + x] = r < 16 ? 30 + r * 0.3 : r < 23 ? 420 : 100 + r;
    }
  const original = heights.slice(),
    rivers = carveMigrationDrainage(size, land, heights, 1);
  expect(rivers.length).toBeGreaterThan(0);
  for (let tile = 0; tile < heights.length; tile++)
    expect(heights[tile]).toBeLessThanOrEqual(original[tile] + 0.001);
  expect(heights[40 * size + 40]).toBeLessThanOrEqual(30);
});
it("rejects malformed authored recipes", () => {
  expect(() =>
    createRegionalTopography(250, 0, {
      ...MIGRATION_THEME.topography,
      maximumHeight: NaN,
    }),
  ).toThrow();
});
it("talus transport does not create peaks when many neighbours feed a depression", () => {
  const land = new Uint8Array(49).fill(1),
    heights = new Float32Array(49).fill(4000);
  heights[24] = 30;
  erodeTerrainSlopes(7, land, heights, { iterations: 20, talus: 1, rate: 0.1 });
  expect(Math.max(...heights)).toBeLessThanOrEqual(4000);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(30);
});
