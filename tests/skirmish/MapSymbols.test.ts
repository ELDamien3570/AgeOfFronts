import { describe, expect, it } from "vitest";
import {
  buildingSymbol,
  squadSymbol,
} from "../../src/skirmish/client/MapSymbols";
import { SPRITE_FOOTPRINT } from "../../src/skirmish/client/UnitAnimation";

describe("map symbol readability", () => {
  it("shows bounded building art inside a square at close zoom and the original square marker at distant zoom", () => {
    expect(buildingSymbol(2, true, "barracks")).toMatchObject({
      artwork: false,
      size: 18,
    });
    expect(buildingSymbol(32, true, "barracks")).toMatchObject({
      artwork: true,
    });
    expect(buildingSymbol(32, true, "barracks").size).toBe(32);
    expect(buildingSymbol(20, false, "barracks")).toMatchObject({
      artwork: false,
      size: 18,
    });
    for (const scale of [28, 40, 96]) {
      const symbol = buildingSymbol(scale, true, "barracks");
      expect(symbol.size).toBe(scale);
      expect(symbol.footprintSize).toBe(scale);
      expect(symbol.inset).toBeGreaterThan(0);
      expect(symbol.size - symbol.inset * 2).toBeCloseTo(scale * 0.85);
      const city = buildingSymbol(scale, true, "city");
      expect(city.size).toBe(scale);
      expect(city.inset).toBe(0);
    }
    expect(buildingSymbol(96, true, "city").size).toBe(96);
    expect(buildingSymbol(2, true, "city").size).toBe(18);
  });
  it("keeps distant glyph pads opaque and only makes them transparent once artwork appears", () => {
    for (const type of [
      "city",
      "factory",
      "port",
      "barracks",
      "archery",
      "stables",
    ] as const) {
      for (const scale of [2, 14, 20, 40])
        for (const hasArtwork of [false, true]) {
          const symbol = buildingSymbol(scale, hasArtwork, type);
          expect(symbol.backdropAlpha).toBe(symbol.artwork ? 0 : 0.9);
          expect(
            buildingSymbol(scale, hasArtwork, type, true).backdropAlpha,
          ).toBe(symbol.artwork ? 0.2 : 0.9);
        }
    }
  });
  it("switches squads to readable formation markers while keeping close art and rotated markers selectable", () => {
    const far = squadSymbol(1, 1_000, true);
    const near = squadSymbol(20, 1_000, true);
    expect(far.artwork).toBe(false);
    expect(far.width).toBeGreaterThan(far.height);
    expect(far.hitRadius).toBeGreaterThanOrEqual(
      Math.hypot(far.width, far.height) / 2,
    );
    expect(near.artwork).toBe(true);
    expect(near.width / 20).toBe(2);
    const close = squadSymbol(96, 1_000, true);
    expect(close.width).toBe(55);
    expect(close.hitRadius).toBeGreaterThan(close.underlayRadius);
    expect(close.viewRadius).toBeGreaterThan(close.hitRadius);
    const frameCornerRadius = Math.hypot(
      near.width / SPRITE_FOOTPRINT / 2,
      near.height / SPRITE_FOOTPRINT / 2,
    );
    expect(near.underlayRadius).toBeLessThan(frameCornerRadius);
    expect(near.underlayRadius).toBeGreaterThan(near.width / 3);
    expect(near.underlayRadius).toBeLessThan(near.width / 2);
    expect(near.viewRadius).toBeGreaterThanOrEqual(frameCornerRadius + 3.6);
    expect(near.hitRadius).toBeGreaterThan(near.underlayRadius);
    expect(squadSymbol(10, 1_000, false).artwork).toBe(false);
  });
});
