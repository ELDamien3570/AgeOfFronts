import { describe, expect, it } from "vitest";
import { buildingOwner } from "./BuildingFixtures";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { BuildingIndex } from "../../src/skirmish/BuildingIndex";
import type { Building } from "../../src/skirmish/Protocol";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import { Fortifications } from "../../src/skirmish/domain/Fortifications";
describe("exact local fortification endpoint index", () => {
  it("releases destroyed wall occupancy for quotes before background index cleanup", () => {
    const map = new GameMapImpl(24, 24, new Uint8Array(576).fill(133), 576),
      forts = new Fortifications(map, new Diplomacy()),
      tower: Building = {
        id: 1,
        playerId: 1,
        type: "tower",
        age: "StoneAge",
        tile: map.ref(4, 4),
        remainingTicks: 0,
      };
    forts.addBarrier({
      id: 1,
      playerId: 1,
      age: "StoneAge",
      a: 1,
      b: 1,
      tiles: [map.ref(6, 4)],
      health: 100,
      maxHealth: 100,
      remainingTicks: 0,
    });
    forts.step(0, [tower]);
    expect(
      forts.towerPlan(map.ref(8, 4), 1, "StoneAge", [tower]).links,
    ).toHaveLength(0);
    forts.updateBarrier(forts.barriers[0].id, { health: 0 });
    expect(
      forts.towerPlan(map.ref(8, 4), 1, "StoneAge", [tower]).links,
    ).toHaveLength(1);
  });
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
    const owner = buildingOwner(buildings, {
      added: record => index.add(record), changed: record => index.changed(record),
      removed: id => index.remove(id), restored: records => index.rebuild(records),
    });
    const local = {
      at: (tile: number) => index.at(tile),
      nearby: (tile: number, radius: number) =>
        index.towersNearby(tile, radius),
    };
    for (const [x, y] of [
      [24, 23],
      [24, 20],
      [22, 28],
      [30, 24],
    ])
      expect(forts.towerPlan(map.ref(x, y), 1, "StoneAge", local)).toEqual(
        forts.towerPlan(map.ref(x, y), 1, "StoneAge", owner.values),
      );
    owner.update(buildings[0].id, { health: 0 });
    expect(
      forts
        .towerPlan(map.ref(24, 23), 1, "StoneAge", local)
        .links.some((l) => l.a === 1),
    ).toBe(false);
    owner.update(buildings[1].id, { remainingTicks: 0 });
    expect(
      forts
        .towerPlan(map.ref(22, 23), 1, "StoneAge", local)
        .links.some((l) => l.a === 2),
    ).toBe(true);
  });
});
