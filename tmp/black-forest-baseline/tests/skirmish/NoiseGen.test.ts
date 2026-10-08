import { describe, expect, test } from "vitest";
import {
  generateNoiseData,
  NOISE_SIZE,
} from "../../src/skirmish/client/NoiseGen";

const S = NOISE_SIZE;
const px = (d: Uint8Array, x: number, y: number, c: number) =>
  d[((y % S) * S + (x % S)) * 4 + c];

describe("generateNoiseData", () => {
  const data = generateNoiseData(1234);

  test("is RGBA8 sized 256x256", () => {
    expect(data.length).toBe(S * S * 4);
  });

  test("is deterministic for a seed and differs between seeds", () => {
    expect(Array.from(generateNoiseData(1234))).toEqual(Array.from(data));
    expect(Array.from(generateNoiseData(99))).not.toEqual(Array.from(data));
  });

  test("tiles: the wrap seam is no rougher than the interior", () => {
    for (let c = 0; c < 4; c++) {
      let maxInterior = 0;
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S - 1; x++)
          maxInterior = Math.max(
            maxInterior,
            Math.abs(px(data, x, y, c) - px(data, x + 1, y, c)),
            Math.abs(px(data, y, x, c) - px(data, y, x + 1, c)),
          );
      let maxSeam = 0;
      for (let i = 0; i < S; i++) {
        // Last column -> first column, last row -> first row.
        maxSeam = Math.max(
          maxSeam,
          Math.abs(px(data, S - 1, i, c) - px(data, S, i, c)),
          Math.abs(px(data, i, S - 1, c) - px(data, i, S, c)),
        );
      }
      expect(maxSeam).toBeLessThanOrEqual(maxInterior);
    }
  });

  test("channels are independent and use the full range", () => {
    for (let c = 0; c < 4; c++) {
      let min = 255;
      let max = 0;
      for (let i = c; i < data.length; i += 4) {
        min = Math.min(min, data[i]);
        max = Math.max(max, data[i]);
      }
      expect(max - min).toBeGreaterThan(80);
    }
    let same = 0;
    for (let i = 0; i < S * S; i++) if (data[i * 4] === data[i * 4 + 1]) same++;
    expect(same / (S * S)).toBeLessThan(0.1);
  });
});

describe("noise feature size", () => {
  // Ripples sample the G channel at about one lattice cell per tile, so all
  // channels must stay smooth between neighbouring texels, not speckled.
  test("channels are smooth between neighbouring texels", () => {
    const data = generateNoiseData(7);
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S - 1; x++)
          sum += Math.abs(px(data, x, y, c) - px(data, x + 1, y, c));
      expect(sum / (S * (S - 1))).toBeLessThan(c === 3 ? 25 : 12);
    }
  });
});
