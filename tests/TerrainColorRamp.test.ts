import { describe, expect, test } from "vitest";
import { encodeTerrainTile } from "../src/client/render/gl/utils/ColorUtils";

const deep: [number, number, number] = [47, 159, 208];
const shallow: [number, number, number] = [92, 200, 224];

function water(magnitude: number, stylized: boolean): number[] {
  const out = new Uint8Array(4);
  encodeTerrainTile(magnitude, out, 0, {
    oceanColor: deep,
    shallowColor: shallow,
    stylized,
  });
  return Array.from(out);
}

describe("stylized water ramp", () => {
  test("magnitude 0 is the shallow colour", () => {
    expect(water(0, true)).toEqual([...shallow, 255]);
  });

  test("ramp reaches the deep colour then darkens gently", () => {
    expect(water(4, true)).toEqual([...deep, 255]);
    expect(water(10, true)).toEqual([
      deep[0] - 6,
      deep[1] - 6,
      deep[2] - 6,
      255,
    ]);
  });

  test("ramp is monotonic from shallow to deep", () => {
    let prev = Infinity;
    for (let m = 0; m <= 4; m++) {
      const r = water(m, true)[0];
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  test("stylized=false keeps the legacy flat encoding", () => {
    // Legacy: shoreline-flag-less water darkens by magnitude from the ocean base.
    expect(water(3, false)).toEqual([
      deep[0] - 3,
      deep[1] - 3,
      deep[2] - 3,
      255,
    ]);
  });

  test("land is unaffected by stylized", () => {
    const a = new Uint8Array(4);
    const b = new Uint8Array(4);
    encodeTerrainTile(0x80 | 5, a, 0, { stylized: true });
    encodeTerrainTile(0x80 | 5, b, 0, { stylized: false });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
