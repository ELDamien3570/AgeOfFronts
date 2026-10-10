import { describe, expect, it } from "vitest";
import { dissectTerrain } from "../../src/skirmish/TerrainDissection";
import { buildTerrainDrainage } from "../../src/skirmish/TerrainDrainage";
const recipe = { strength: 1.25, drainagePasses: 2, incision: 240 };
function fixture(size = 400) {
  const land = new Uint8Array(size * size),
    heights = new Float32Array(size * size).fill(-100),
    shore = new Float32Array(size * size);
  for (let y = 3; y < size - 3; y++)
    for (let x = 3; x < size - 3; x++) {
      const tile = y * size + x;
      land[tile] = 1;
      shore[tile] = Math.min(x - 2, y - 2, size - 3 - x, size - 3 - y);
      heights[tile] = x < size / 2 ? 1800 + y * 0.1 : 150 + y * 0.1;
    }
  return { size, land, heights, shore };
}
const roughness = (
  f: ReturnType<typeof fixture>,
  minimumX: number,
  maximumX: number,
) => {
  let sum = 0,
    cells = 0;
  for (let y = 20; y < f.size - 20; y++)
    for (let x = minimumX; x < maximumX; x++) {
      const t = y * f.size + x;
      sum += Math.abs(
        f.heights[t] -
          (f.heights[t - 1] +
            f.heights[t + 1] +
            f.heights[t - f.size] +
            f.heights[t + f.size]) /
            4,
      );
      cells++;
    }
  return sum / cells;
};
describe("selected-resolution terrain dissection", () => {
  it("retains fine upland relief while lowlands remain calmer and coast cells unchanged", () => {
    const f = fixture(),
      mask = f.land.slice();
    dissectTerrain(f.size, f.land, f.heights, f.shore, [], 42, recipe);
    expect(f.land).toEqual(mask);
    for (let t = 0; t < mask.length; t++) {
      if (!mask[t]) expect(f.heights[t]).toBe(-100);
      else expect(f.heights[t]).toBeGreaterThan(0);
    }
    const rugged = roughness(f, 20, 160),
      calm = roughness(f, 240, 380);
    expect(rugged).toBeGreaterThan(8);
    expect(calm).toBeLessThan(rugged / 3);
    const drainage = buildTerrainDrainage(f.size, f.land, f.heights);
    expect(drainage.order.length).toBe(mask.reduce((sum, v) => sum + v, 0));
  });
  it("reproduces its height surface and changes the surface with its seed", () => {
    const a = fixture(100),
      b = fixture(100),
      c = fixture(100);
    for (const [f, seed] of [
      [a, 42],
      [b, 42],
      [c, 43],
    ] as const)
      dissectTerrain(f.size, f.land, f.heights, f.shore, [], seed, recipe);
    expect(a.heights).toEqual(b.heights);
    expect(c.heights).not.toEqual(a.heights);
  });
  it("keeps drainage incision below the detailed surface without changing water", () => {
    const a = fixture(100),
      b = fixture(100);
    dissectTerrain(a.size, a.land, a.heights, a.shore, [], 17, {
      ...recipe,
      drainagePasses: 0,
    });
    dissectTerrain(b.size, b.land, b.heights, b.shore, [], 17, recipe);
    let cut = 0;
    for (let t = 0; t < a.heights.length; t++) {
      expect(b.heights[t]).toBeLessThanOrEqual(a.heights[t]);
      cut += Number(a.heights[t] - b.heights[t] > 10);
    }
    expect(cut).toBeGreaterThan(100);
  });
  it("rejects unbounded budgets and invalid arrays", () => {
    const f = fixture(100);
    expect(() =>
      dissectTerrain(f.size, f.land, f.heights, f.shore, [], 42, {
        ...recipe,
        drainagePasses: 100,
      }),
    ).toThrow();
    expect(() =>
      dissectTerrain(
        f.size,
        f.land,
        f.heights,
        new Float32Array(1),
        [],
        42,
        recipe,
      ),
    ).toThrow();
  });
});
