import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { BuildingSelectionViewModel } from "../../src/skirmish/client/BuildingSelectionViewModel";
import { Renderer } from "../../src/skirmish/client/Renderer";
import type { Building } from "../../src/skirmish/Protocol";

const building = (id: number, tile = id, playerId = 1): Building => ({
  id,
  tile,
  playerId,
  type: "barracks",
  remainingTicks: 0,
});
describe("building group selection", () => {
  it("adds and toggles building stacks while retaining a valid inspection focus", () => {
    const selection = new BuildingSelectionViewModel();
    selection.select([building(1), building(2, 1)]);
    selection.select([building(3)], true, true);
    expect([...selection.ids]).toEqual([1, 2, 3]);
    selection.select([building(1), building(2, 1)], true, true);
    expect([...selection.ids]).toEqual([3]);
    expect(selection.focused).toBe(3);
    selection.select([building(3)], true, true);
    expect(selection.focused).toBeNull();
  });
  it("removes captured, dead and demolished buildings on authoritative updates", () => {
    const selection = new BuildingSelectionViewModel();
    selection.select([building(1), building(2), building(3)]);
    selection.reconcile([building(1, 1, 2), { ...building(2), health: 0 }], 1);
    expect(selection.ids.size).toBe(0);
    expect(selection.focused).toBeNull();
  });
  it("selects only friendly matching buildings within the current zoomed viewport", () => {
    const terrain = new Uint8Array(100 * 80).fill(133);
    const map = new GameMapImpl(100, 80, terrain, terrain.length);
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      map,
      width: 200,
      height: 120,
      scale: 10,
      fitScale: 1,
      offsetX: 0,
      offsetY: 0,
      snapshot: {
        localPlayerId: 1,
        buildings: [
          building(1, map.ref(10, 5)),
          building(2, map.ref(30, 5)),
          building(3, map.ref(10, 5), 2),
          { ...building(4, map.ref(10, 5)), type: "stables" },
        ],
      },
      eraArtwork: { get: () => undefined },
      buildingArtwork: { get: () => undefined },
    }) as Renderer;
    expect(renderer.visibleBuildings("barracks")).toEqual([1]);
    renderer.zoom(0.5, 0, 0);
    expect(renderer.visibleBuildings("barracks")).toEqual([1, 2]);
  });
});
