import { describe, expect, it } from "vitest";
import { buildTerrainDrainage } from "../../src/skirmish/TerrainDrainage";

describe("terrain drainage", () => {
  it("drains a closed depression to the sea with no uphill steps or cycles", () => {
    const size = 11,
      land = new Uint8Array(size * size),
      heights = new Float32Array(size * size);
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const tile = y * size + x;
        land[tile] = 1;
        heights[tile] =
          x === 5 && y === 5 ? 2 : 20 + Math.abs(x - 5) + Math.abs(y - 5);
      }
    const result = buildTerrainDrainage(size, land, heights),
      again = buildTerrainDrainage(size, land, heights);
    expect(result.downstream).toEqual(again.downstream);
    expect(result.accumulation).toEqual(again.accumulation);
    for (let tile = 0; tile < land.length; tile++)
      if (land[tile]) {
        let next = tile,
          steps = 0;
        while (land[next]) {
          const parent = result.downstream[next];
          expect(parent).toBeGreaterThanOrEqual(0);
          if (land[parent]) {
            expect(result.surface[parent]).toBeLessThan(result.surface[next]);
            expect(result.accumulation[parent]).toBeGreaterThan(
              result.accumulation[next],
            );
          }
          next = parent;
          expect(++steps).toBeLessThan(land.length);
        }
      }
    expect(result.surface[5 * size + 5]).toBeGreaterThan(heights[5 * size + 5]);
    const total = result.order.reduce(
      (sum, tile) =>
        sum + (!land[result.downstream[tile]] ? result.accumulation[tile] : 0),
      0,
    );
    expect(total).toBe(81);
  });
});
