import { describe, expect, test } from "vitest";
import {
  bakeCoastDistance,
  bakeTerrainFields,
  blurField,
  decodeCoastDistance,
  encodeCoastDistance,
} from "../../src/skirmish/client/TerrainFields";

function mask(w: number, h: number, fn: (x: number, y: number) => boolean) {
  const land = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) land[y * w + x] = fn(x, y) ? 1 : 0;
  return land;
}

describe("coast signed distance", () => {
  test("land negative, water positive, coast tiles at -+0.5", () => {
    const W = 40,
      d = bakeCoastDistance(
        mask(W, 8, (x) => x < 20),
        W,
        8,
      );
    expect(d[4 * W + 19]).toBeCloseTo(-0.5, 5);
    expect(d[4 * W + 20]).toBeCloseTo(0.5, 5);
    expect(d[4 * W + 15]).toBeCloseTo(-4.5, 5);
    expect(d[4 * W + 25]).toBeCloseTo(5.5, 5);
  });

  test("clamped to 8 tiles", () => {
    const W = 60,
      d = bakeCoastDistance(
        mask(W, 4, (x) => x < 30),
        W,
        4,
      );
    expect(d[2 * W]).toBeCloseTo(-8, 5);
    expect(d[2 * W + 59]).toBeCloseTo(8, 5);
  });

  test("diagonals approximate sqrt 2 per step", () => {
    const W = 40,
      d = bakeCoastDistance(
        mask(W, W, (x, y) => x < 10 && y < 10),
        W,
        W,
      );
    // Water tile diagonal to the land corner: nearest land centre is sqrt2 away.
    expect(d[10 * W + 10]).toBeCloseTo(Math.SQRT2 - 0.5, 1);
    expect(d[13 * W + 13]).toBeCloseTo(4 * Math.SQRT2 - 0.5, 1);
  });

  test("an isolated lake is positive inside land and symmetric", () => {
    const W = 21,
      d = bakeCoastDistance(
        mask(W, W, (x, y) => !(x >= 8 && x <= 12 && y >= 8 && y <= 12)),
        W,
        W,
      );
    expect(d[10 * W + 10]).toBeGreaterThan(0);
    expect(d[10 * W + 8]).toBeCloseTo(d[10 * W + 12], 5);
    expect(d[10 * W + 7]).toBeLessThan(0);
  });

  test("byte encoding round trips within a quantization step", () => {
    for (const v of [-8, -3.2, -0.5, 0, 0.5, 4.4, 8])
      expect(
        Math.abs(decodeCoastDistance(encodeCoastDistance(v)) - v),
      ).toBeLessThan(0.04);
    expect(encodeCoastDistance(100)).toBe(255);
    expect(encodeCoastDistance(-100)).toBe(0);
  });
});

describe("blurField", () => {
  test("keeps a constant field constant and spreads a spike", () => {
    const flat = blurField(new Float32Array(100).fill(7), 10, 10, 2);
    for (const v of flat) expect(v).toBeCloseTo(7, 4);
    const spike = new Float32Array(121);
    spike[60] = 121;
    const out = blurField(spike, 11, 11, 1, 1);
    expect(out[60]).toBeCloseTo(121 / 9, 3);
    expect(out[61]).toBeCloseTo(121 / 9, 3);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum).toBeCloseTo(121, 2);
  });
});

describe("fields texture", () => {
  const W = 48,
    H = 16,
    land = mask(W, H, (x) => x < 24);
  test("without elevation hillshade is flat and depth zero", () => {
    const f = bakeTerrainFields({ width: W, height: H, land });
    for (let i = 0; i < W * H; i++) {
      expect(f[i * 4 + 1]).toBe(128);
      expect(f[i * 4 + 2]).toBe(0);
      expect(f[i * 4 + 3]).toBe(255);
    }
  });

  test("elevated inland rivers do not invent sea-level cliffs along flat banks", () => {
    const land = mask(W, H, (x) => x !== 24);
    const heights = new Float32Array(W * H).fill(1200);
    const f = bakeTerrainFields({
      width: W,
      height: H,
      land,
      elevation: { heights, seaLevel: 0 },
    });
    for (let i = 0; i < W * H; i++) {
      expect(f[i * 4 + 1]).toBe(128);
      expect(f[i * 4 + 2]).toBe(0);
    }
  });

  test("a smooth slope shades with no step edges; depth grows from the coast", () => {
    const heights = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        heights[y * W + x] = x < 24 ? 10 + x * 20 : -(x - 24) * 30;
    const f = bakeTerrainFields({
      width: W,
      height: H,
      land,
      elevation: { heights, seaLevel: 0 },
    });
    const g = (x: number) => f[(8 * W + x) * 4 + 1];
    // Rising toward +x is lit like terrainRelief (brighter), and smooth.
    expect(g(12)).toBeGreaterThan(128);
    let largest = 0;
    for (let x = 4; x < 19; x++)
      largest = Math.max(largest, Math.abs(g(x + 1) - g(x)));
    expect(largest).toBeLessThanOrEqual(4);
    const b = (x: number) => f[(8 * W + x) * 4 + 2];
    expect(b(10)).toBe(0);
    expect(b(26)).toBeGreaterThan(0);
    expect(b(40)).toBeGreaterThan(b(26));
  });
});
