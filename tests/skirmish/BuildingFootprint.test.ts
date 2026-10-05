import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  boundsOverlap,
  buildingFootprint,
  buildingGroundBounds,
  buildingNavigationClearedBounds,
  buildingReservationBounds,
} from "../../src/skirmish/BuildingFootprint";
import { BuildingIndex } from "../../src/skirmish/BuildingIndex";
import { fittedBuildingSprite } from "../../src/skirmish/client/BuildingSpriteLayout";
import { constructionRejection } from "../../src/skirmish/Construction";
import { portWaterTiles } from "../../src/skirmish/PortWaterAccess";
import type { Building, Player } from "../../src/skirmish/Protocol";

const map = new GameMapImpl(96, 64, new Uint8Array(96 * 64).fill(133), 96 * 64);
describe("building footprints and reservations", () => {
  it("defines cities, military production, ordinary buildings, and the tall airstrip", () => {
    expect(buildingFootprint("city")).toEqual({ width: 4, height: 4 });
    for (const type of [
      "barracks",
      "archery",
      "stables",
      "siege-workshop",
      "arms-factory",
    ] as const)
      expect(buildingFootprint(type)).toEqual({ width: 3, height: 3 });
    expect(buildingFootprint("airstrip")).toEqual({ width: 3, height: 4 });
    for (const type of ["factory", "mine", "port", "tower"] as const)
      expect(buildingFootprint(type)).toEqual({ width: 2, height: 2 });
  });
  it("reserves exactly one cell on each side of the occupied rectangle", () => {
    const tile = map.ref(10, 10);
    expect(buildingGroundBounds(map, tile, "city")).toEqual({
      left: 10,
      top: 10,
      right: 14,
      bottom: 14,
    });
    expect(buildingReservationBounds(map, tile, "city")).toEqual({
      left: 9,
      top: 9,
      right: 15,
      bottom: 15,
    });
    expect(buildingReservationBounds(map, tile, "airstrip")).toEqual({
      left: 9,
      top: 9,
      right: 14,
      bottom: 15,
    });
  });
  it("allows touching borders but rejects shared reserved cells, including diagonal corners", () => {
    const first = buildingReservationBounds(map, map.ref(10, 10), "factory");
    expect(
      boundsOverlap(
        first,
        buildingReservationBounds(map, map.ref(14, 10), "factory"),
      ),
    ).toBe(false);
    expect(
      boundsOverlap(
        first,
        buildingReservationBounds(map, map.ref(13, 13), "factory"),
      ),
    ).toBe(true);
    expect(
      boundsOverlap(
        first,
        buildingReservationBounds(map, map.ref(14, 14), "factory"),
      ),
    ).toBe(false);
  });
  it("queries each physical site once across sector boundaries and stacked buildings", () => {
    const index = new BuildingIndex(map);
    const buildings: Building[] = Array.from({ length: 15 }, (_, id) => ({
      id: id + 1,
      playerId: 1,
      type: "city",
      tile: map.ref(15, 15),
      remainingTicks: 0,
    }));
    index.rebuild(buildings);
    expect([
      ...index.reservationConflicts(map.ref(20, 15), "factory"),
    ]).toHaveLength(1);
    expect([
      ...index.reservationConflicts(map.ref(21, 15), "factory"),
    ]).toHaveLength(0);
    for (const building of buildings) index.remove(building.id);
    expect([
      ...index.reservationConflicts(map.ref(20, 15), "factory"),
    ]).toHaveLength(0);
  });
  it("keeps the preexisting forest navigation clearance around the logical anchor", () => {
    for (const type of ["city", "barracks", "factory", "airstrip"] as const)
      expect(
        buildingNavigationClearedBounds(map, map.ref(10, 10), type),
      ).toEqual({ left: 9, top: 9, right: 12, bottom: 12 });
  });
  it("checks every occupied cell but permits borders over unowned land and water", () => {
    const terrain = new Uint8Array(20 * 20).fill(133);
    const m = new GameMapImpl(20, 20, terrain, 400);
    const owners = new Uint8Array(400);
    const player = { id: 1, gold: 1_000_000 } as Player;
    for (let y = 5; y < 9; y++)
      for (let x = 5; x < 9; x++) owners[m.ref(x, y)] = 1;
    const tile = m.ref(5, 5);
    expect(
      constructionRejection(m, owners, [], player, "city", tile),
    ).toBeNull();
    owners[m.ref(8, 8)] = 2;
    expect(
      constructionRejection(m, owners, [], player, "city", tile),
    ).toContain("friendly");
    owners.fill(1);
    expect(
      constructionRejection(m, owners, [], player, "city", m.ref(17, 17)),
    ).toContain("friendly");
    expect(
      constructionRejection(m, owners, [], player, "city", m.ref(0, 0)),
    ).toBeNull();
    terrain[m.ref(6, 6)] = 0;
    const coast = new GameMapImpl(20, 20, terrain, 399);
    expect(
      constructionRejection(coast, owners, [], player, "factory", tile),
    ).toContain("friendly");
    expect(
      constructionRejection(coast, owners, [], player, "port", m.ref(7, 5)),
    ).toBeNull();
  });
  it("enforces reservation separation consistently for array and indexed construction, including stacking", () => {
    const owners = new Uint8Array(96 * 64).fill(1);
    const player = { id: 1, gold: 1_000_000 } as Player;
    const b: Building = {
      id: 1,
      playerId: 1,
      type: "city",
      tile: map.ref(10, 10),
      remainingTicks: 0,
    };
    const index = new BuildingIndex(map);
    index.rebuild([b]);
    for (const source of [[b], index]) {
      expect(
        constructionRejection(map, owners, source, player, "city", b.tile),
      ).toBeNull();
      expect(
        constructionRejection(
          map,
          owners,
          source,
          player,
          "factory",
          map.ref(15, 10),
        ),
      ).toContain("border");
      expect(
        constructionRejection(
          map,
          owners,
          source,
          player,
          "factory",
          map.ref(16, 10),
        ),
      ).toBeNull();
    }
    const stacked = Array.from({ length: 15 }, (_, id) => ({
      ...b,
      id: id + 1,
    }));
    index.rebuild(stacked);
    expect(
      constructionRejection(map, owners, index, player, "city", b.tile),
    ).toContain("15");
    index.verify(stacked);
  });

  it("uses the occupied perimeter for ports whose anchor is inland and fits tall artwork without stretching it", () => {
    const terrain = new Uint8Array(20 * 20).fill(133);
    for (let y = 0; y < 20; y++)
      for (let x = 12; x < 20; x++) terrain[y * 20 + x] = 0;
    const m = new GameMapImpl(20, 20, terrain, 240),
      tile = m.ref(10, 5);
    expect(m.neighbors(tile).some((t) => m.isWater(t))).toBe(false);
    expect(
      constructionRejection(
        m,
        new Uint8Array(400).fill(1),
        [],
        { id: 1, gold: 10000 } as Player,
        "port",
        tile,
      ),
    ).toBeNull();
    expect(portWaterTiles(m, tile)).toEqual([m.ref(12, 5), m.ref(12, 6)]);
    const fitted = fittedBuildingSprite(
      { x: 0, y: 0, width: 81, height: 114 },
      100,
      100,
      30,
      40,
    );
    expect(fitted.width).toBeLessThanOrEqual(30);
    expect(fitted.height).toBe(40);
    expect(fitted.width / fitted.height).toBeCloseTo(81 / 114);
  });
});
