import { describe, expect, test } from "vitest";
import {
  bakeTerrainFields,
  bakeTerrainFieldsRect,
  decodeCoastDistance,
  FIELD_PAD,
  padRect,
} from "../src/client/render/gl/utils/TerrainFields";

const LAND = 0x80 | 5;
const WATER = 0x20;
const IMPASSABLE = 0x80 | 31;

function makeMap(
  w: number,
  h: number,
  fn: (x: number, y: number) => number,
): Uint8Array {
  const t = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) t[y * w + x] = fn(x, y);
  return t;
}

const dist = (f: Uint8Array, w: number, x: number, y: number) =>
  decodeCoastDistance(f[(y * w + x) * 2]);
const elev = (f: Uint8Array, w: number, x: number, y: number) =>
  f[(y * w + x) * 2 + 1];

describe("TerrainFields bake", () => {
  test("sign: land negative, water positive; coast tiles at +-0.5", () => {
    const W = 40;
    const t = makeMap(W, 8, (x) => (x < 20 ? LAND : WATER));
    const f = bakeTerrainFields(t, W, 8);
    expect(dist(f, W, 19, 4)).toBeCloseTo(-0.5, 1);
    expect(dist(f, W, 20, 4)).toBeCloseTo(0.5, 1);
    expect(dist(f, W, 15, 4)).toBeCloseTo(-4.5, 1);
    expect(dist(f, W, 25, 4)).toBeCloseTo(5.5, 1);
    expect(dist(f, W, 0, 4)).toBeLessThan(0);
    expect(dist(f, W, 39, 4)).toBeGreaterThan(0);
  });

  test("clamped to +-8 tiles", () => {
    const W = 60;
    const t = makeMap(W, 4, (x) => (x < 30 ? LAND : WATER));
    const f = bakeTerrainFields(t, W, 4);
    expect(dist(f, W, 0, 2)).toBeCloseTo(-8, 1);
    expect(dist(f, W, 59, 2)).toBeCloseTo(8, 1);
    expect(f[(2 * W + 0) * 2]).toBe(0);
    expect(f[(2 * W + 59) * 2]).toBe(255);
  });

  test("a map of only water or only land stays clamped", () => {
    const f = bakeTerrainFields(
      makeMap(10, 10, () => WATER),
      10,
      10,
    );
    expect(dist(f, 10, 5, 5)).toBeCloseTo(8, 1);
    const g = bakeTerrainFields(
      makeMap(10, 10, () => LAND),
      10,
      10,
    );
    expect(dist(g, 10, 5, 5)).toBeCloseTo(-8, 1);
  });

  test("diagonal distance is about sqrt(2) per step", () => {
    const W = 20;
    // Single land tile at (5,5); water elsewhere.
    const t = makeMap(W, W, (x, y) => (x === 5 && y === 5 ? LAND : WATER));
    const f = bakeTerrainFields(t, W, W);
    // Orthogonal neighbour: 1 - 0.5; diagonal neighbour: sqrt2 - 0.5.
    expect(dist(f, W, 6, 5)).toBeCloseTo(0.5, 1);
    expect(dist(f, W, 6, 6)).toBeCloseTo(Math.SQRT2 - 0.5, 1);
    expect(Math.abs(dist(f, W, 8, 8) - (3 * Math.SQRT2 - 0.5))).toBeLessThan(
      0.1,
    );
  });

  test("impassable counts as land with elevation 1", () => {
    const W = 20;
    const t = makeMap(W, 4, (x) => (x < 10 ? IMPASSABLE : WATER));
    const f = bakeTerrainFields(t, W, 4);
    expect(dist(f, W, 9, 2)).toBeCloseTo(-0.5, 1);
    expect(elev(f, W, 9, 2)).toBe(255);
    expect(elev(f, W, 15, 2)).toBe(0);
  });

  test("elevation encodes magnitude / 30 on land, 0 on water", () => {
    const t = new Uint8Array([0x80 | 15, 0x80 | 30, WATER | 9]);
    const f = bakeTerrainFields(t, 3, 1);
    expect(elev(f, 3, 0, 0)).toBe(Math.round((15 / 30) * 255));
    expect(elev(f, 3, 1, 0)).toBe(255);
    expect(elev(f, 3, 2, 0)).toBe(0);
  });

  test("incremental rect recompute equals a full rebake", () => {
    const W = 80;
    const H = 60;
    const before = makeMap(W, H, (x, y) =>
      (x - 40) ** 2 + (y - 30) ** 2 < 600 ? LAND : WATER,
    );
    const field = bakeTerrainFields(before, W, H);
    // Nuke: convert a blob of land to water.
    const rect = { x: 30, y: 22, w: 14, h: 12 };
    const after = before.slice();
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) after[y * W + x] = WATER;
    const upd = bakeTerrainFieldsRect(after, W, H, rect);
    for (let y = 0; y < upd.h; y++)
      for (let x = 0; x < upd.w; x++) {
        const dst = ((upd.y + y) * W + upd.x + x) * 2;
        field[dst] = upd.data[(y * upd.w + x) * 2];
        field[dst + 1] = upd.data[(y * upd.w + x) * 2 + 1];
      }
    expect(Array.from(field)).toEqual(
      Array.from(bakeTerrainFields(after, W, H)),
    );
  });

  test("padRect expands by FIELD_PAD and clamps to the map", () => {
    expect(padRect({ x: 20, y: 20, w: 5, h: 5 }, 100, 100)).toEqual({
      x: 20 - FIELD_PAD,
      y: 20 - FIELD_PAD,
      w: 5 + 2 * FIELD_PAD,
      h: 5 + 2 * FIELD_PAD,
    });
    expect(padRect({ x: 0, y: 0, w: 5, h: 5 }, 10, 8)).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 8,
    });
  });
});
