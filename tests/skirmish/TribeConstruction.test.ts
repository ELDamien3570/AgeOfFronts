import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import { constructionRejection } from "../../src/skirmish/Construction";
import { buildingTechnology } from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  tribeBuildingLimit,
  tribeBuildingRejection,
  tribeProductionLimit,
} from "../../src/skirmish/domain/TribeDevelopment";
import type { BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const cells = new Uint8Array(128 * 96).fill(133),
    map = new GameMapImpl(128, 96, cells, cells.length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: true,
    tribeCount: 1,
    runAi: false,
    ruleset: "ages-v1",
  });
  const id = game.players.find((p) => p.kind === "tribe")!.id;
  const saved = game.checkpoint();
  saved.owners.fill(id);
  game.restore(saved);
  const player = game.players.find((p) => p.id === id)!,
    e = game.expansion!,
    state = e.progression.states[id];
  player.gold = 10000000;
  state.age = "Modern";
  state.completed = TECHNOLOGIES.map((t) => t.id);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const sites = [
    map.ref(12, 12),
    map.ref(24, 12),
    map.ref(100, 20),
    map.ref(48, 12),
    map.ref(60, 12),
    map.ref(72, 12),
  ];
  e.supply.replaceDeposits(
    sites.map((tile, i) => ({
      id: 10000 + i,
      tile,
      owner: id,
      resource: i < 3 ? "ironOre" : "copper",
      yieldPerSecond: 1,
    })),
  );
  const add = (type: BuildingType, tile: number, remainingTicks = 0) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: id,
      type,
      tile,
      age: "Modern",
      remainingTicks,
      health: 1200,
    });
  return { game, map, player, e, state, sites, add };
}

describe("authoritative tribal production limits", () => {
  it("allows two plus two per age for all production categories while preserving defensive limits", () => {
    expect(AGES.map(tribeProductionLimit)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16,
    ]);
    for (const age of AGES) {
      expect(tribeBuildingLimit("mine", age)).toBe(2);
      for (const type of [
        "city",
        "factory",
        "port",
        "barracks",
        "archery",
        "stables",
        "blacksmith",
        "armory",
        "arms-factory",
        "siege-workshop",
        "depot",
        "airstrip",
        "oil-well",
        "oil-rig",
        "nuclear-facility",
        "drone-facility",
        "missile-silo",
        "mirv-launcher",
      ] as const)
        expect(tribeBuildingLimit(type, age)).toBe(
          buildingTechnology(type, age) ? tribeProductionLimit(age) : 0,
        );
      for (const type of [
        "tower",
        "gun-nest",
        "trench",
        "missile-defence",
      ] as const)
        expect(tribeBuildingLimit(type, age)).toBe(
          buildingTechnology(type, age) ? 2 : 0,
        );
      expect(tribeBuildingLimit("anti-air-emplacement", age)).toBe(
        buildingTechnology("anti-air-emplacement", age) ? 1 : 0,
      );
    }
  });
  it("counts two paid mine foundations per mineral across deposits without suppressing other minerals", () => {
    const f = fixture(),
      build = (tile: number) =>
        f.game.applyCommand({
          type: "build",
          playerId: f.player.id,
          buildingType: "mine",
          tile,
          age: "Modern",
        });
    expect(build(f.sites[0])).toBeNull();
    expect(build(f.sites[1])).toBeNull();
    expect(f.game.buildings.every((b) => b.remainingTicks > 0)).toBe(true);
    const gold = f.player.gold;
    expect(build(f.sites[2])).toContain("2 mines for each mineral resource");
    expect(f.player.gold).toBe(gold);
    expect(build(f.sites[3])).toBeNull();
    expect(build(f.sites[4])).toBeNull();
    expect(build(f.sites[5])).toContain("2 mines");
    expect(f.game.buildingSite(f.player.id, "mine", f.sites[2])).toContain(
      "2 mines",
    );
  });
  it("rejects every tribal stack while regular factions retain their site rules", () => {
    const f = fixture();
    for (const type of [
      "mine",
      "city",
      "factory",
      "barracks",
      "nuclear-facility",
      "gun-nest",
    ] as const) {
      const tile = f.map.ref(20, 30),
        building = {
          id: 999,
          playerId: f.player.id,
          type,
          tile,
          remainingTicks: 0,
        };
      expect(
        constructionRejection(
          f.map,
          f.game.owners,
          [building],
          f.player,
          type,
          tile,
          false,
        ),
      ).toBe("Tribes cannot stack buildings");
      expect(
        constructionRejection(
          f.map,
          f.game.owners,
          [building],
          { ...f.player, kind: "regular" },
          type,
          tile,
          false,
        ),
      ).toBeNull();
    }
  });
  it("preserves captured or restored over-cap buildings and only prevents new foundations", () => {
    const f = fixture();
    for (const tile of f.sites.slice(0, 3)) f.add("mine", tile);
    f.e.supply.addDeposit({
      id: 20000,
      tile: f.map.ref(36, 12),
      owner: f.player.id,
      resource: "ironOre",
      yieldPerSecond: 1,
    });
    const saved = f.game.checkpoint();
    f.game.restore(saved);
    expect(f.game.checkpoint()).toEqual(saved);
    expect(f.game.buildingFacts().countOfType(f.player.id, "mine")).toBe(3);
    expect(
      f.game.applyCommand({
        type: "build",
        playerId: f.player.id,
        buildingType: "mine",
        tile: f.map.ref(36, 12),
        age: "Modern",
      }),
    ).toContain("2 mines");
  });
  it("does not classify oil wells as mines of the deposit beneath them", () => {
    const f = fixture();
    f.add("mine", f.sites[0]);
    f.add("oil-well", f.sites[1]);
    expect(
      tribeBuildingRejection(
        f.player,
        "mine",
        f.sites[2],
        "Modern",
        f.game.buildings,
        (t) => f.e.supply.resourceSites.at(t)?.resource,
      ),
    ).toBeNull();
  });
  it("invalidates a distant cached preview when another mine exhausts the shared resource cap", () => {
    const f = fixture();
    f.add("mine", f.sites[0]);
    const preview = new PlacementPreview(f.map, () => 0),
      bounds = { left: 96, top: 16, right: 111, bottom: 31 };
    preview.begin(f.game.snapshot(), f.player.id, "mine");
    expect(preview.sites(bounds, 256)).toContain(f.sites[2]);
    f.add("mine", f.sites[1], 100);
    preview.update(f.game.snapshot());
    expect(preview.sites(bounds, 256)).not.toContain(f.sites[2]);
    expect(preview.rejection("mine", f.sites[2], false)).toContain("2 mines");
  });
  it("resumes bounded tribal land placement beyond the nearest 256 tiles and through restore", () => {
    const f = fixture();
    f.state.age = "StoneAge";
    f.state.completed = [buildingTechnology("city", "StoneAge")!];
    for (const tree of ["economic", "warfare", "naval"] as const)
      f.state.research[tree] = {
        technologyId: f.state.completed[0],
        totalTicks: 100000,
        remainingTicks: 100000,
      };
    const near = new Set(
      f.game.ownedLandNearest(f.player.id, f.player.base, 256),
    );
    const recovery = vi
      .spyOn(f.e.economy.recovery, "canBuild")
      .mockImplementation((_id, _type, tile) => !near.has(tile));
    const think = () => {
      f.game.tick += 24;
      (
        f.e as unknown as { thinkTribeDevelopment(p: typeof f.player): void }
      ).thinkTribeDevelopment(f.player);
    };
    for (let i = 0; i < 8; i++) {
      const before = recovery.mock.calls.length;
      think();
      expect(recovery.mock.calls.length - before).toBeLessThanOrEqual(16);
    }
    const saved = f.game.checkpoint();
    for (let i = 0; i < 20 && !f.game.buildings.length; i++) think();
    const expected = f.game.checkpoint();
    expect(f.game.buildings).toHaveLength(1);
    expect(near.has(f.game.buildings[0].tile)).toBe(false);
    f.game.restore(saved);
    for (let i = 0; i < 20 && !f.game.buildings.length; i++) think();
    expect(f.game.checkpoint()).toEqual(expected);
  });
});
