import { describe, expect, it } from "vitest";
import {
  TacticalFeatureIndex,
  scorePosition,
} from "../../src/skirmish/domain/TacticalFeatureIndex";
import { tacticalTerrain } from "../../src/skirmish/domain/TacticalTerrain";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { FIXED } from "../../src/skirmish/Protocol";
import { hillMap } from "./fixtures/HillDefence";
const setup = () => {
  const map = hillMap(),
    paths = new LandPaths(map),
    index = new TacticalFeatureIndex(tacticalTerrain(map), paths);
  return { map, paths, index };
};
describe("static tactical features", () => {
  it("builds incrementally, rejects the spire, and filters disconnected hill candidates", () => {
    const { map, paths, index } = setup();
    index.step();
    expect(index.ready).toBe(false);
    expect(index.near(map.ref(32, 35))).toEqual([]);
    while (!index.ready) expect(index.step()).toBeLessThanOrEqual(16);
    expect(index.hills.some((f) => f.tile === map.ref(12, 15))).toBe(false);
    expect(
      index.hills.some((f) => f.component === paths.component[map.ref(32, 35)]),
    ).toBe(true);
    const island = index.hills.find(
      (f) => f.component !== paths.component[map.ref(32, 35)],
    )!;
    expect(
      scorePosition(index, island, {
        objectiveTile: map.ref(45, 25),
        threatStrength: 1,
        army: {
          frontWidth: FIXED,
          maxRangedRange: 6 * FIXED,
          component: paths.component[map.ref(32, 35)],
        },
        ownTerritory: () => true,
        routeLength: () => 5,
      }),
    ).toBe(-Infinity);
    expect(index.near(map.ref(32, 35)).length).toBeLessThanOrEqual(6);
  });
  it("rebuilds identical buckets and hashes, including a partially built checkpoint", () => {
    const a = setup();
    a.index.step();
    const partial = a.index.checkpoint(),
      b = setup();
    b.index.restore(partial);
    expect(b.index.checkpoint()).toEqual(partial);
    while (!a.index.ready) a.index.step();
    while (!b.index.ready) b.index.step();
    expect(b.index.hills).toEqual(a.index.hills);
    expect(b.index.checkpoint()).toEqual(a.index.checkpoint());
    const bad = { ...a.index.checkpoint(), featureIndexHash: 0 };
    expect(() => b.index.restore(bad)).toThrow(/hash/);
  });
  it("scores territory, coverage and shorter certified routes; rejects unusable frontage and unknown routes", () => {
    const { map, paths, index } = setup();
    index.step(64);
    const f = index.hills.find((f) => f.tile === map.ref(32, 32))!;
    const ctx = {
      objectiveTile: map.ref(32, 35),
      threatCentroid: { x: 32 * FIXED, y: 40 * FIXED },
      threatStrength: 1,
      army: {
        frontWidth: 4 * FIXED,
        maxRangedRange: 6 * FIXED,
        component: paths.component[f.tile],
      },
      ownTerritory: () => false,
      routeLength: () => 10,
    };
    const base = scorePosition(index, f, ctx);
    expect(
      scorePosition(index, f, { ...ctx, ownTerritory: () => true }),
    ).toBeGreaterThan(base);
    expect(
      scorePosition(index, f, { ...ctx, routeLength: () => 5 }),
    ).toBeGreaterThan(base);
    expect(
      scorePosition(index, f, { ...ctx, rangeAt: () => 20 * FIXED }),
    ).toBeGreaterThan(base);
    expect(
      scorePosition(index, f, { ...ctx, routeLength: () => undefined }),
    ).toBe(-Infinity);
    expect(
      scorePosition(index, f, {
        ...ctx,
        army: { ...ctx.army, frontWidth: 40 * FIXED },
      }),
    ).toBe(-Infinity);
    expect(
      scorePosition(index, f, { ...ctx, objectiveTile: map.ref(0, 0) }),
    ).toBe(-Infinity);
    expect(scorePosition(index, { ...f, rearAccess: false }, ctx)).toBe(
      -Infinity,
    );
  });
  it("produces no hills without calibrated heights", () => {
    const map = hillMap(false),
      index = new TacticalFeatureIndex(
        tacticalTerrain(map),
        new LandPaths(map),
      );
    index.step(64);
    expect(index.hills).toEqual([]);
  });
});
