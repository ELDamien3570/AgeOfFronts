import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { BuildingIndex } from "../../src/skirmish/BuildingIndex";
import type { Building } from "../../src/skirmish/Protocol";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import { Fortifications } from "../../src/skirmish/domain/Fortifications";
describe("exact local fortification endpoint index", () => {
  it("preserves nearest endpoint, stack, tier, completion and occupied bend rules", () => {
    const data = new Uint8Array(100 * 80).fill(133),
      map = new GameMapImpl(100, 80, data, data.length),
      forts = new Fortifications(map, new Diplomacy()),
      buildings: Building[] = [
        {
          id: 1,
          playerId: 1,
          type: "tower",
          age: "StoneAge",
          tile: map.ref(20, 20),
          remainingTicks: 0,
        },
        {
          id: 2,
          playerId: 1,
          type: "tower",
          age: "StoneAge",
          tile: map.ref(20, 20),
          remainingTicks: 10,
        },
        {
          id: 3,
          playerId: 1,
          type: "tower",
          age: "BronzeAge",
          tile: map.ref(28, 20),
          remainingTicks: 0,
        },
        {
          id: 4,
          playerId: 1,
          type: "tower",
          age: "StoneAge",
          tile: map.ref(28, 23),
          remainingTicks: 0,
        },
        {
          id: 5,
          playerId: 2,
          type: "tower",
          age: "StoneAge",
          tile: map.ref(24, 28),
          remainingTicks: 0,
        },
        {
          id: 6,
          playerId: 1,
          type: "city",
          tile: map.ref(24, 20),
          remainingTicks: 0,
        },
      ],
      index = new BuildingIndex(map);
    for (let id = 7; id < 1000; id++)
      buildings.push({
        id,
        playerId: 1,
        type: "city",
        tile: map.ref(90, 70),
        remainingTicks: 0,
      });
    index.rebuild(buildings);
    const local = {
      at: (tile: number) => index.at(tile),
      nearby: (tile: number, radius: number) => index.towersNearby(tile, radius),
    };
    for (const [x, y] of [
      [24, 23],
      [24, 20],
      [22, 28],
      [30, 24],
    ])
      expect(forts.towerPlan(map.ref(x, y), 1, "StoneAge", local)).toEqual(
        forts.towerPlan(map.ref(x, y), 1, "StoneAge", buildings),
      );
    buildings[0].health = 0;
    expect(
      forts
        .towerPlan(map.ref(24, 23), 1, "StoneAge", local)
        .links.some((l) => l.a === 1),
    ).toBe(false);
    buildings[1].remainingTicks = 0;
    expect(
      forts
        .towerPlan(map.ref(22, 23), 1, "StoneAge", local)
        .links.some((l) => l.a === 2),
    ).toBe(true);
  });
});
