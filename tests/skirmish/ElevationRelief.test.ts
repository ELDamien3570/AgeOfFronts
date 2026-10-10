import { expect, it } from "vitest";
import { elevationRelief } from "../../src/skirmish/client/ElevationRelief";
import { ElevationField } from "../../src/skirmish/Elevation";
it("lights opposing faces differently while high flat plateaus remain flat", () => {
  expect(elevationRelief(() => 3500, 20, 20, 5)).toBe(0);
  const lit = elevationRelief((x, y) => 2000 - x * 20 - y * 20, 20, 20, 5),
    dark = elevationRelief((x, y) => 2000 + x * 20 + y * 20, 20, 20, 5);
  expect(lit).toBeGreaterThan(0);
  expect(dark).toBeLessThan(-20);
});
it("validates optional presentation gain without changing elevation", () => {
  const data = {
    values: new Float32Array([1200]),
    minimum: 0,
    maximum: 6000,
    seaLevel: 0,
    reliefScale: 5,
  };
  expect(new ElevationField(1, data).heightAt(0)).toBe(1200);
  expect(() => new ElevationField(1, { ...data, reliefScale: NaN })).toThrow();
});
