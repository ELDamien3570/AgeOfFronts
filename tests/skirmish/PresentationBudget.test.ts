import { describe, expect, it } from "vitest";
import {
  shipSymbol,
  shipViewRadius,
  squadSymbol,
  squadViewRadius,
} from "../../src/skirmish/client/MapSymbols";
import { RenderSamples } from "../../src/skirmish/client/RenderSamples";

describe("P14 retained presentation samples", () => {
  it("retains one wrapper and only the previous coordinates, removing dead identities", () => {
    const samples = new RenderSamples<{
      id: number;
      x: number;
      y: number;
      detail: string;
    }>();
    samples.update([{ id: 1, x: 10, y: 20, detail: "first" }], 1);
    const wrapper = samples.get(1);
    samples.update([{ id: 1, x: 30, y: 40, detail: "second" }], 2);
    expect(samples.get(1)).toBe(wrapper);
    expect(wrapper).toMatchObject({
      previousX: 10,
      previousY: 20,
      current: { detail: "second" },
    });
    samples.update([], 3);
    expect(samples.size).toBe(0);
    samples.update([{ id: 1, x: 50, y: 60, detail: "recreated" }], 4);
    expect(samples.get(1)).not.toBe(wrapper);
    expect(samples.get(1)).toMatchObject({ previousX: 50, previousY: 60 });
    samples.clear();
    expect(samples.size).toBe(0);
  });
  it("preserves interpolation during duplicate-tick status publications", () => {
    const samples = new RenderSamples<{ id: number; x: number; y: number }>();
    samples.update([{ id: 1, x: 10, y: 20 }], 1);
    samples.update([{ id: 1, x: 30, y: 40 }], 2);
    samples.update([{ id: 1, x: 30, y: 40 }], 2);
    expect(samples.get(1)).toMatchObject({ previousX: 10, previousY: 20 });
    samples.update([{ id: 1, x: 35, y: 45 }], 2);
    expect(samples.get(1)).toMatchObject({ previousX: 10, previousY: 20 });
    samples.update([{ id: 1, x: 35, y: 45 }], 3);
    expect(samples.get(1)).toMatchObject({ previousX: 35, previousY: 45 });
  });
  it("bounds retention by current entities across continuous arrivals and removals", () => {
    const samples = new RenderSamples<{ id: number; x: number; y: number }>();
    for (let tick = 0; tick < 500; tick++) {
      samples.update(
        Array.from({ length: 20 }, (_, i) => ({ id: tick + i, x: i, y: tick })),
        tick,
      );
      expect(samples.size).toBe(20);
    }
  });
  it("coarse viewport radii enclose art and fallback symbols at every LOD", () => {
    for (const scale of [0.1, 1, 4, 14, 28, 60, 100])
      for (const troops of [1, 100, 1000, 2000])
        for (const formation of ["infantry", "cavalry", "siege"] as const)
          for (const art of [true, false]) {
            const symbol = squadSymbol(scale, troops, art, formation);
            expect(
              squadViewRadius(scale, troops, false),
            ).toBeGreaterThanOrEqual(symbol.viewRadius);
            expect(squadViewRadius(scale, troops, true)).toBeGreaterThanOrEqual(
              scale * 2,
            );
          }
  });
});

it("coarse ship bounds enclose sprites and fallback formations before artwork lookup", () => {
  for (const scale of [0.1, 1, 4, 14, 28, 60, 100])
    for (const kind of ["warship"] as const)
      for (const formation of [false, true])
        for (const art of [false, true])
          expect(shipViewRadius(scale, kind)).toBeGreaterThanOrEqual(
            shipSymbol(scale, formation, kind, art).viewRadius,
          );
});
