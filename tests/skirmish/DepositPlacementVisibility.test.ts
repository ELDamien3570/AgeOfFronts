import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import type { Resource } from "../../src/skirmish/domain/Definitions";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const cells = new Uint8Array(64 * 64).fill(133);
  const map = new GameMapImpl(64, 64, cells, cells.length);
  const match = new Skirmish(map, { seed: 42, aiCount: 1, tribes: false,
    runAi: false, ruleset: "ages-v1" });
  match.owners.fill(1);
  match.buildings.length = 0;
  match.players[0].gold = 1e6;
  const state = match.expansion!.progression.states[1];
  state.completed = TECHNOLOGIES.map(t => t.id);
  match.expansion!.supply.deposits.splice(0, Infinity,
    ...(["stone", "copper", "tin", "ironOre", "oil"] as Resource[]).map((resource, id) => ({
      id: id + 1, tile: map.ref(20 + id * 5, 20), resource, owner: 1, yieldPerSecond: 1,
    })));
  return { match, map, state, deposits: match.expansion!.supply.deposits };
}
describe("age-correct deposit placement", () => {
  it("rejects undiscovered minerals in both preview and authority, even with forged unlocks", () => {
    const { match, map, deposits } = fixture();
    const preview = new PlacementPreview(map);
    preview.begin(match.snapshot(), 1, "mine", "StoneAge");
    for (const node of deposits) {
      const valid = node.resource === "stone";
      expect(preview.rejection("mine", node.tile) === null).toBe(valid);
      expect(match.buildingPlacement(1, "mine", node.tile, "StoneAge") === null).toBe(valid);
    }
  });
  it("invalidates cached mine highlights on age advancement without terrain changes", () => {
    const { match, map, deposits, state } = fixture();
    const preview = new PlacementPreview(map), bounds = { left: 16, top: 16, right: 47, bottom: 31 };
    preview.begin(match.snapshot(), 1, "mine", "StoneAge");
    expect(preview.sites(bounds, 1024)).toEqual([deposits[0].tile]);
    state.age = "BronzeAge";
    const snapshot = match.snapshot(); snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(new Set(preview.sites(bounds, 1024))).toEqual(new Set(deposits.slice(0, 3).map(d => d.tile)));
    expect(preview.rejection("mine", deposits[3].tile)).not.toBeNull();
    expect(match.buildingPlacement(1, "mine", deposits[1].tile, "StoneAge")).toBeNull();
  });
});
