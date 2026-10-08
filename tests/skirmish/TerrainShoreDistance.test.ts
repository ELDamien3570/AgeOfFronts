import { expect, it } from "vitest";
import { terrainShoreDistance } from "../../src/skirmish/TerrainShoreDistance";
it("measures geometric distance rather than diamond-shaped grid distance", () => {
  const land = new Uint8Array(49).fill(1);
  land[0] = 0;
  const distance = terrainShoreDistance(7, land);
  expect(distance[0]).toBe(0);
  expect(distance[1]).toBe(0.5);
  expect(distance[4 * 7 + 3]).toBeCloseTo(4.5);
  expect(distance[6 * 7 + 6]).toBeCloseTo(Math.sqrt(72) - 0.5);
});
