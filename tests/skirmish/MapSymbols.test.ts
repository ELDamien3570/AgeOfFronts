import { describe, expect, it } from "vitest";
import {
  buildingSymbol,
  shipSpriteSize,
  shipSymbol,
  squadSymbol,
} from "../../src/skirmish/client/MapSymbols";
import { SPRITE_FOOTPRINT } from "../../src/skirmish/client/UnitAnimation";

describe("map symbol readability", () => {
  it("shows bounded building art inside its occupied footprint at close zoom and the original square marker at distant zoom", () => {
    expect(buildingSymbol(2, true, "barracks")).toMatchObject({
      artwork: false,
      size: 18,
    });
    expect(buildingSymbol(32, true, "barracks")).toMatchObject({
      artwork: true,
    });
    expect(buildingSymbol(32, true, "barracks").size).toBe(64);
    expect(buildingSymbol(20, false, "barracks")).toMatchObject({
      artwork: false,
      size: 18,
    });
    for (const scale of [28, 40, 96]) {
      const symbol = buildingSymbol(scale, true, "barracks");
      expect(symbol.size).toBe(scale * 2);
      expect(symbol.footprintSize).toBe(scale * 2);
      expect(symbol.inset).toBeGreaterThan(0);
      expect(symbol.size - symbol.inset * 2).toBeCloseTo(scale * 1.85);
      const city = buildingSymbol(scale, true, "city");
      expect(city.size).toBe(scale * 3);
      expect(city.inset).toBe(0);
    }
    expect(buildingSymbol(96, true, "city").size).toBe(288);
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
  it("scales warships 2.5x and transports 1.75x at max zoom with proportional hit and view radii", () => {
    // Zoom threshold where era artwork appears is scale >= 12
    expect(shipSpriteSize(12, "warship")).toBeCloseTo(28.8);
    expect(shipSpriteSize(12, "transport")).toBeCloseTo(28.8);

    // Max zoom scale = 96
    const warshipBase = shipSpriteSize(96, "warship");
    const transportBase = shipSpriteSize(96, "transport");
    expect(warshipBase).toBe(125); // 2.5x original 50 cap
    expect(transportBase).toBe(87.5); // 1.75x original 50 cap

    // With 4/3 artwork extent
    const warshipSym = shipSymbol(96, true, "warship", true);
    const transportSym = shipSymbol(96, true, "transport", true);

    expect(warshipSym.width).toBeCloseTo((125 * 4) / 3);
    expect(warshipSym.hitRadius).toBeCloseTo(warshipSym.width * 0.38);
    expect(warshipSym.viewRadius).toBeGreaterThan(warshipSym.width / 2);

    expect(transportSym.width).toBeCloseTo((87.5 * 4) / 3);
    expect(transportSym.hitRadius).toBeCloseTo(transportSym.width * 0.38);
    expect(transportSym.viewRadius).toBeGreaterThan(transportSym.width / 2);

    // Distant without shipArt retains formation marker
    const distant = shipSymbol(8, true, "warship", false);
    expect(distant.formation).toBe(true);
    expect(distant.height).toBe(24);
  });
});
