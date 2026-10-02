import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { constructionRejection } from "../../src/skirmish/Construction";
import { Skirmish } from "../../src/skirmish/Simulation";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
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
    deposits[0].owner = 2;
    expect(index.update(deposits)).toBe(false);
    deposits[0].tile = map.ref(3, 3);
    expect(index.update(deposits)).toBe(true);
    expect(index.at(deposits[0].tile)).toBe(deposits[0]);
  });
});
