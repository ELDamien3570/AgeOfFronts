import { describe, expect, it } from "vitest";
import { TerrainType } from "../../src/core/game/Game";
import { generateBlackForest } from "../../src/skirmish/BlackForestMap";
import { blackForestTopography } from "../../src/skirmish/BlackForestTopography";
describe("wooded hill terrain", () => {
  it.each([250, 500, 1000])(
    "%i: produces hills and valleys without mountains, blocked land or alpine biomes",
    (size) => {
      const loaded = generateBlackForest(size, 42);
      let peak = 0,
        low = Infinity,
        hills = 0,
        invalid = 0;
      for (let t = 0; t < loaded.terrain.length; t++) {
        if (!loaded.map.isLand(t)) continue;
        const type = loaded.map.terrainType(t);
        invalid += Number(
          (type !== TerrainType.Plains && type !== TerrainType.Highland) ||
            loaded.map.isImpassable(t) ||
            loaded.environment!.familyAt(t) === "alpine",
        );
        hills += Number(type === TerrainType.Highland);
        peak = Math.max(peak, loaded.elevation!.values[t]);
        low = Math.min(low, loaded.elevation!.values[t]);
      }
      expect(invalid).toBe(0);
      expect(hills).toBeGreaterThan(size * size * 0.01);
      expect(peak - low).toBeGreaterThan(200);
      expect(peak).toBeLessThan(1200);
      for (const clearing of loaded.layout.clearings) {
        const tile = loaded.map.ref(
          Math.floor(clearing.x),
          Math.floor(clearing.y),
        );
        expect(loaded.map.terrainType(tile)).toBe(TerrainType.Plains);
      }
    },
    30000,
  );
  it("reproduces the wooded relief and varies it between seeds", () => {
    const a = blackForestTopography(250, 3),
      b = blackForestTopography(250, 3),
      c = blackForestTopography(250, 4);
    expect(a.heights).toEqual(b.heights);
    expect(a.landforms).toEqual(b.landforms);
    expect(c.heights).not.toEqual(a.heights);
  });
});
