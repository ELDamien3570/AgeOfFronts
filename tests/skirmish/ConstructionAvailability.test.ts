import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { buildingTechnology } from "../../src/skirmish/content/Buildings";

describe("temporary fortification placement gate", () => {
  it.each(["sandbox-v1", "ages-v1"] as const)("rejects construction without spending or creating walls in %s", (ruleset) => {
    const cells = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(64, 64, cells, cells.length), {
      seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset,
    });
    const player = game.player(1)!;
    player.gold = 1_000_000;
    game.owners.fill(1);
    for (const building of game.buildings) game.removeBuilding(building.id);
    const existing = game.addBuilding({ id: game.allocateId(), playerId: 1,
      type: "tower", tile: game.map.ref(20, 20), remainingTicks: 0, age: "StoneAge" });
    game.expansion?.progression.states[1].completed.push(buildingTechnology("tower", "StoneAge")!);
    const tile = game.map.ref(26, 20), before = game.checkpoint();
    const reason = "Tower and wall placement is temporarily disabled";
    expect(game.buildingSite(1, "tower", tile)).toBe(reason);
    expect(game.buildingPlacement(1, "tower", tile)).toBe(reason);
    expect(game.applyCommand({ type: "build", playerId: 1, buildingType: "tower", tile })).toBe(reason);
    expect(game.checkpoint()).toEqual(before);
    expect(game.building(existing.id)).toBe(existing);
    const preview = new PlacementPreview(game.map);
    preview.begin(game.snapshot(), 1, "tower", "StoneAge");
    expect(preview.rejection("tower", tile)).toBe(reason);
    expect(preview.sites({left: 24, top: 18, right: 28, bottom: 22}, 256)).toEqual([]);
    if (game.expansion) {
      const vm = new EmpireViewModel(game.snapshot(), {selected: new Set(), selectedShips: new Set(), selectedBuilding: null});
      expect(vm.buildingVisible("tower")).toBe(false);
      expect(vm.buildChoice("tower").reason).toBe(reason);
      expect(vm.buildingPreview("tower").reason).toBe(reason);
      expect(vm.buildingVisible("barracks")).toBe(true);
    }
  });
});
