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
  it("reaches sparse friendly territory without spending its quote budget on the rest of the viewport", () => {
    const { snapshot } = fixture();
    const map = new GameMapImpl(
      512,
      512,
      new Uint8Array(512 * 512).fill(133),
      512 * 512,
    );
    snapshot.owners = new Uint8Array(512 * 512);
    snapshot.buildings = [];
    for (let y = 480; y < 496; y++)
      for (let x = 480; x < 496; x++) snapshot.owners[map.ref(x, y)] = 1;
    const preview = new PlacementPreview(map);
    preview.begin(snapshot, 1, "factory");
    const sites = preview.sites(
      { left: 0, top: 0, right: 511, bottom: 511 },
      256,
    );
    // A 2x2 factory must fit entirely inside the 16x16 owned region.
    expect(sites).toHaveLength(225);
    expect(preview.diagnostics.tested).toBe(256);
  });

  it("prioritizes the cursor region before distant owned chunks", () => {
    const { map, snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.update(snapshot);
    const sites = preview.sites(
      { left: 0, top: 0, right: 95, bottom: 63 },
      1,
      map.ref(90, 50),
    );
    expect(sites).toEqual([map.ref(80, 48)]);
  });

  it("limits rendering work by elapsed CPU time and continues on the next frame", () => {
    const { map, snapshot } = fixture();
    snapshot.buildings = [];
    let time = 0;
    const preview = new PlacementPreview(map, () => (time += 0.1));
    preview.begin(snapshot, 1, "factory");
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    const first = preview.sites(bounds);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(256);
    expect(preview.sites(bounds).length).toBeGreaterThan(first.length);
  });

  it("retains quotes across a pan and a return to a recent building mode", () => {
    const { snapshot, preview } = fixture();
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    const sites = preview.sites(bounds, 256);
    preview.sites({ left: 32, top: 32, right: 47, bottom: 47 }, 256);
    preview.cancel();
    preview.begin(snapshot, 1, "port");
    expect(preview.sites(bounds, 256)).toEqual([]);
    preview.cancel();
    preview.begin(snapshot, 1, "factory");
    const tested = preview.diagnostics.tested;
    expect(preview.sites(bounds, 1)).toEqual(sites);
    expect(preview.diagnostics.tested).toBe(tested);
  });

  it("refreshes retained ownership when reopening without synchronous quotes", () => {
    const { snapshot, preview } = fixture();
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    const tile = preview.sites(bounds, 256)[0];
    preview.cancel();
    snapshot.owners[tile] = 2;
    const tested = preview.diagnostics.tested;
    preview.update(snapshot);
    expect(preview.diagnostics.tested).toBe(tested);
    preview.begin(snapshot, 1, "factory");
    expect(preview.sites(bounds, 256)).not.toContain(tile);
  });

  it("keeps partial scans advancing through repeated multiplayer ownership updates", () => {
    const { map, snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.update(snapshot);
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    const observed = new Set<number>();
    for (let packet = 0; packet < 16; packet++) {
      snapshot.owners[map.ref(0, 0)] = packet % 2 ? 1 : 2;
      snapshot.changedTiles = new Uint32Array([map.ref(0, 0)]);
      preview.update(snapshot);
      for (const tile of preview.sites(bounds, 17)) observed.add(tile);
    }
    expect(observed.has(map.ref(15, 15))).toBe(true);
  });

  it("does not let an ownership change every packet starve other visible chunks", () => {
    const { map, snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.update(snapshot);
    const bounds = { left: 0, top: 0, right: 31, bottom: 15 };
    const observed = new Set<number>();
    for (let packet = 0; packet < 32; packet++) {
      snapshot.owners[0] = packet % 2 ? 1 : 2;
      preview.update(snapshot);
      for (const tile of preview.sites(bounds, 17, 0)) observed.add(tile);
    }
    expect(observed.has(map.ref(31, 15))).toBe(true);
  });

  it("bounds offscreen cache retention when panning across a large world", () => {
    const { snapshot } = fixture();
    const map = new GameMapImpl(
      4096,
      16,
      new Uint8Array(4096 * 16).fill(133),
      4096 * 16,
    );
    snapshot.owners = new Uint8Array(4096 * 16).fill(1);
    snapshot.buildings = [];
    const preview = new PlacementPreview(map);
    preview.begin(snapshot, 1, "factory");
    for (let x = 0; x < 4096; x += 16)
      preview.sites({ left: x, top: 0, right: x + 15, bottom: 15 }, 256);
    expect(preview.diagnostics.cachedChunks).toBeLessThanOrEqual(129);
  });

  it("evicts old building modes instead of retaining every building grid", () => {
    const { snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.update(snapshot);
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 };
    preview.sites(bounds, 256);
    for (const type of ["tower", "port", "mine", "oil-well"] as const) {
      preview.begin(snapshot, 1, type);
      preview.sites(bounds, 256);
    }
    preview.begin(snapshot, 1, "factory");
    const tested = preview.diagnostics.tested;
    expect(preview.sites(bounds, 1)).toHaveLength(1);
    expect(preview.diagnostics.tested).toBe(tested + 1);
  });

  it("caps discovery work even when the presentation clock has coarse resolution", () => {
    const { snapshot } = fixture();
    const map = new GameMapImpl(
      512,
      512,
      new Uint8Array(512 * 512).fill(133),
      512 * 512,
    );
    snapshot.owners = new Uint8Array(512 * 512);
    snapshot.buildings = [];
    const preview = new PlacementPreview(map, () => 0);
    preview.begin(snapshot, 1, "factory");
    preview.sites({ left: 0, top: 0, right: 511, bottom: 511 });
    expect(preview.diagnostics.examined).toBe(65_536);
    expect(preview.diagnostics.tested).toBe(0);
  });

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
    game.updateBuilding(endpoint.id, { remainingTicks: 1 });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    game.updateBuilding(endpoint.id, { remainingTicks: 0 });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).not.toContain(tile);
    game.updateBuilding(endpoint.id, { age: "BronzeAge" });
    snapshot = game.snapshot();
    snapshot.changedTiles = new Uint32Array();
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).toContain(tile);
  });
  it("does no tile enumeration at activation and limits candidate quotes", () => {
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
    game.expansion!.supply.updateDeposit(deposits[0].id, { owner: 2 });
    expect(index.update(deposits)).toBe(false);
    game.expansion!.supply.updateDeposit(deposits[0].id, {
      tile: map.ref(3, 3),
    });
    expect(index.update(deposits)).toBe(true);
    expect(index.at(deposits[0].tile)).toBe(deposits[0]);
  });
  it("invalidates a cached anchor when ownership changes in a neighboring footprint chunk", () => {
    const { map, snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.begin(snapshot, 1, "blacksmith");
    const bounds = { left: 0, top: 0, right: 31, bottom: 31 },
      tile = map.ref(15, 15);
    expect(preview.sites(bounds, 1024)).toContain(tile);
    snapshot.owners[map.ref(16, 16)] = 2;
    preview.update(snapshot);
    expect(preview.sites(bounds, 0)).not.toContain(tile);
    expect(preview.sites(bounds, 1024)).not.toContain(tile);
    snapshot.owners[map.ref(16, 16)] = 1;
    preview.update(snapshot);
    expect(preview.sites(bounds, 1024)).toContain(tile);
  });
  it("tracks footprint ownership outside the scanned viewport", () => {
    const { map, snapshot, preview } = fixture();
    snapshot.buildings = [];
    preview.begin(snapshot, 1, "blacksmith");
    const bounds = { left: 0, top: 0, right: 15, bottom: 15 },
      tile = map.ref(15, 15);
    expect(preview.sites(bounds, 256)).toContain(tile);
    snapshot.owners[map.ref(16, 16)] = 2;
    preview.update(snapshot);
    expect(preview.sites(bounds, 0)).not.toContain(tile);
    snapshot.owners[map.ref(16, 16)] = 1;
    preview.update(snapshot);
    expect(preview.sites(bounds, 256)).toContain(tile);
  });
});
