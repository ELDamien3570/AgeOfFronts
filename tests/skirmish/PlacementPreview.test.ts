import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { constructionRejection } from "../../src/skirmish/Construction";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import {
  buildingCost,
  buildingTechnology,
} from "../../src/skirmish/content/Buildings";
import { ResourceSiteIndex } from "../../src/skirmish/domain/ResourceSiteIndex";
import { resourceSiteRejection } from "../../src/skirmish/domain/StartingResources";

function fixture() {
  const map = new GameMapImpl(
    96,
    64,
    new Uint8Array(96 * 64).fill(133),
    96 * 64,
  );
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
  });
  const snapshot = game.snapshot();
  snapshot.owners.fill(1);
  snapshot.players[0].gold = 1_000_000;
  const preview = new PlacementPreview(map);
  preview.begin(snapshot, 1, "factory");
  return { map, snapshot, preview };
}
describe("bounded placement preview", () => {
  it("quotes automatic wall gold and troop clearance identically to domain construction", () => {
    const { map } = fixture(),
      game = new Skirmish(map, {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      });
    game.owners.fill(1);
    game.expansion!.supply.replaceDeposits([]);
    game.expansion!.progression.states[1].completed.push(
      buildingTechnology("tower", "StoneAge")!,
    );
    for (const building of game.buildings) game.removeBuilding(building.id);
    const endpoint: Building = game.addBuilding({
      id: game.allocateId(),
      playerId: 1,
      type: "tower",
      age: "StoneAge",
      tile: map.ref(20, 20),
      remainingTicks: 0,
      health: 2000,
    });
    for (const squad of game.squads) {
      game.updateSquad(squad.id, { x: 60.5 * FIXED });
      game.updateSquad(squad.id, { y: 50.5 * FIXED });
    }
    game.expansion!.fortifications.step(game.tick, game.buildings);
    const player = game.players.find((p) => p.id === 1)!,
      tile = map.ref(24, 20),
      base = buildingCost("tower", "StoneAge", 1).gold!,
      bounds = { left: 16, top: 16, right: 31, bottom: 31 },
      preview = new PlacementPreview(map);
    player.gold = base;
    preview.begin(game.snapshot(), 1, "tower", "StoneAge");
    expect(preview.rejection("tower", tile)).toBe(
      game.buildingPlacement(1, "tower", tile, "StoneAge"),
    );
    expect(preview.rejection("tower", tile)).toBe("Not enough gold");
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    const tested = preview.diagnostics.tested;
    player.gold = base + 75;
    let snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 1)).toContain(tile);
    expect(preview.diagnostics.tested).toBe(tested);
    expect(preview.rejection("tower", tile)).toBeNull();
    game.updateSquad(game.squads[0].id, { x: 22.5 * FIXED });
    game.updateSquad(game.squads[0].id, { y: 20.5 * FIXED });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.rejection("tower", tile)).toBe(
      game.buildingPlacement(1, "tower", tile, "StoneAge"),
    );
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    game.updateSquad(game.squads[0].id, { x: 60.5 * FIXED });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).toContain(tile);
    player.gold = base;
    game.updateBuilding((endpoint).id, { remainingTicks: 1 });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    game.updateBuilding((endpoint).id, { remainingTicks: 0 });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    game.updateBuilding((endpoint).id, { age: "BronzeAge" });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).toContain(tile);
  });
  it("does no tile enumeration at activation and charges every examined cell", () => {
    const { preview } = fixture();
    expect(preview.diagnostics.tested).toBe(0);
    preview.sites({ left: 0, top: 0, right: 95, bottom: 63 }, 17);
    expect(preview.diagnostics.tested).toBe(17);
  });
  it("agrees with construction rules and invalidates changed ownership chunks", () => {
    const { map, snapshot, preview } = fixture(),
      bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    const actual = preview.sites(bounds, 256);
    const expected: number[] = [];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const tile = map.ref(x, y);
        if (
          !constructionRejection(
            map,
            snapshot.owners,
            snapshot.buildings,
            snapshot.players[0],
            "factory",
            tile,
          )
        )
          expected.push(tile);
      }
    expect(actual).toEqual(expected);
    const tile = actual[0];
    snapshot.owners[tile] = 2;
    snapshot.changedTiles = new Uint32Array([tile]);
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).not.toContain(tile);
  });
  it("cancels incomplete work when changing mode", () => {
    const { snapshot, preview } = fixture(),
      bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    preview.sites(bounds, 13);
    preview.cancel();
    expect(preview.sites(bounds, 100)).toEqual([]);
    preview.begin(snapshot, 1, "port");
    expect(preview.sites(bounds, 256)).toEqual([]);
  });
  it("hides cached sandbox sites when funds become insufficient", () => {
    const { snapshot, preview } = fixture(),
      bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    expect(preview.sites(bounds, 256).length).toBeGreaterThan(0);
    snapshot.players[0].gold = 0;
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).toEqual([]);
  });
  it("updates exclusion indexes only when resource placement changes", () => {
    const { map } = fixture();
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    const deposits = game.expansion!.supply.deposits,
      index = new ResourceSiteIndex(map);
    expect(index.update(deposits)).toBe(true);
    for (let tile = 0; tile < 96 * 64; tile++)
      expect(index.rejection("factory", tile)).toBe(
        resourceSiteRejection(map, deposits, "factory", tile),
      );
    game.expansion!.supply.updateDeposit(deposits[0].id, {owner: 2});
    expect(index.update(deposits)).toBe(false);
    game.expansion!.supply.updateDeposit(deposits[0].id, {tile: map.ref(3, 3)});
    expect(index.update(deposits)).toBe(true);
    expect(index.at(deposits[0].tile)).toBe(deposits[0]);
  });
});
