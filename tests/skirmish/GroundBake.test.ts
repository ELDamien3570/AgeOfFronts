import { describe, expect, test } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { forestOf } from "../../src/skirmish/Forest";
import {
  bakeGroundColors,
  rebakeGroundColors,
  type BakeSource,
} from "../../src/skirmish/client/GroundBake";
import {
  paintedCell,
  paintedRgb,
  terrainRelief,
} from "../../src/skirmish/client/PaintedTerrain";
import { TerrainEnvironment } from "../../src/skirmish/client/TerrainEnvironment";

const W = 96,
  H = 64;
// Land left of x=40 with a few plains/highland/mountain bands; water right.
function terrain() {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      t[y * W + x] = x >= 40 ? 0x20 : 0x80 | (x < 14 ? 5 : x < 28 ? 14 : 24);
  return t;
}
function setup(withForest: boolean) {
  const cover = new Uint8Array(W * H);
  if (withForest)
    for (let i = 0; i < cover.length; i++)
      if (i % W < 40 && (i * 7) % 5 < 3) cover[i] = 200;
  const heights = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      heights[y * W + x] = x < 40 ? 20 + x * 9 + Math.sin(y / 3) * 15 : -60;
  const map = createSkirmishMap(
    W,
    H,
    terrain(),
    { values: heights, minimum: -100, maximum: 800, seaLevel: 0 },
    { cover },
  );
  const environment = new TerrainEnvironment(map),
    relief = terrainRelief(map);
  const source: BakeSource = {
    width: W,
    height: H,
    land: Array.from({ length: W * H }, (_, i) => (map.isLand(i) ? 1 : 0)),
    rgbAt: (tile) => paintedRgb(map, tile, relief, environment),
  };
  return { map, environment, relief, source };
}
const parse = (css: string) =>
  css
    .slice(4, -1)
    .split(",")
    .map((v) => Math.max(0, Math.min(255, Number(v))));

describe("ground colour bake", () => {
  test("matches paintedCell exactly for sampled land tiles", () => {
    const { map, environment, relief, source } = setup(true),
      baked = bakeGroundColors(source);
    let checked = 0;
    for (let tile = 0; tile < W * H; tile += 7) {
      if (!map.isLand(tile)) continue;
      const expected = parse(paintedCell(map, tile, relief, environment).color);
      expect(Array.from(baked.subarray(tile * 4, tile * 4 + 4))).toEqual([
        ...expected,
        255,
      ]);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  test("water away from land keeps its painted colour; coast water takes the land colour", () => {
    const { map, environment, relief, source } = setup(false),
      baked = bakeGroundColors(source);
    const far = 20 * W + 80,
      near = 20 * W + 40;
    expect(Array.from(baked.subarray(far * 4, far * 4 + 3))).toEqual(
      parse(paintedCell(map, far, relief, environment).color),
    );
    const land = parse(
      paintedCell(map, 20 * W + 39, relief, environment).color,
    );
    for (let c = 0; c < 3; c++)
      expect(Math.abs(baked[near * 4 + c] - land[c])).toBeLessThanOrEqual(25);
    expect(baked[near * 4 + 2]).not.toBe(
      parse(paintedCell(map, near, relief, environment).color)[2],
    );
  });

  test("forest cover changes re-bake just the touched texels", () => {
    const { map, environment, relief, source } = setup(true),
      baked = bakeGroundColors(source),
      forest = forestOf(map)!;
    const site = map.ref(10, 30);
    const changed = forest.updateBuildings(map, [{ tile: site, type: "city" }]);
    expect(changed.length).toBeGreaterThan(0);
    const rects = rebakeGroundColors(source, baked, changed);
    expect(rects.length).toBeGreaterThan(0);
    // The partial update equals a full bake of the new cover.
    expect(Array.from(baked)).toEqual(Array.from(bakeGroundColors(source)));
    for (const r of rects) {
      expect(r.data.length).toBe(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const at = ((r.y + y) * W + r.x + x) * 4;
          expect(
            Array.from(
              r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4),
            ),
          ).toEqual(Array.from(baked.subarray(at, at + 4)));
        }
    }
    const t = map.ref(10, 30);
    expect(Array.from(baked.subarray(t * 4, t * 4 + 3))).toEqual(
      parse(paintedCell(map, t, relief, environment).color),
    );
  });
});
