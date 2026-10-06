import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingGroundBounds } from "../../src/skirmish/BuildingFootprint";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { startingCamp } from "../../src/skirmish/domain/StartingCamp";
import { startingResources } from "../../src/skirmish/domain/StartingResources";
import { LandPaths } from "../../src/skirmish/Pathfinding";
import { Skirmish } from "../../src/skirmish/Simulation";
describe("starting cities and constrained resources", () => {
  it.each(AGES)(
    "gives every %s faction a completed city and an immediately buildable, affordable barracks",
    (startingAge) => {
      const data = new Uint8Array(120 * 80).fill(133),
        map = new GameMapImpl(120, 80, data, data.length);
      const game = new Skirmish(map, {
        seed: 47,
        aiCount: 2,
        tribes: true,
        tribeCount: 2,
        runAi: false,
        ruleset: "ages-v1",
        startingAge,
      });
      for (const player of game.players) {
        const city = game.buildings.find(
          (b) => b.playerId === player.id && b.type === "city",
        )!;
        expect(city).toBeDefined();
        expect(city.remainingTicks).toBe(0);
        const bounds = buildingGroundBounds(map, city.tile, "city");
        for (let y = bounds.top; y < bounds.bottom; y++)
          for (let x = bounds.left; x < bounds.right; x++)
            expect(game.owners[map.ref(x, y)]).toBe(player.id);
        const camp = startingCamp(map, game.paths, player.base, 6)!;
        expect(
          game.applyCommand({
            type: "build",
            playerId: player.id,
            buildingType: "barracks",
            tile: camp.barracks,
          }),
        ).toBeNull();
      }
    },
  );
  it("starts on a small island without requiring the full resource catalogue", () => {
    const width = 120,
      height = 80,
      data = new Uint8Array(width * height);
    for (let y = 20; y < 30; y++)
      for (let x = 20; x < 30; x++) data[y * width + x] = 133;
    for (let y = 10; y < 70; y++)
      for (let x = 60; x < 114; x++) data[y * width + x] = 133;
    const map = new GameMapImpl(width, height, data, data.length),
      base = map.ref(24, 24);
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
      humanSpawns: [{ playerId: 1, tile: base }],
    });
    expect(game.players[0].base).toBe(base);
    game.step();
    const resources = game
      .expansion!.supply.deposits.filter((d) => d.owner === 1)
      .map((d) => d.resource);
    expect(resources).toContain("copper");
    expect(resources).toContain("tin");
    expect(resources.length).toBeLessThan(8);
  });
  it("does not throw when no resource extraction patch fits", () => {
    const data = new Uint8Array(32 * 32),
      map = new GameMapImpl(32, 32, data, data.length),
      base = map.ref(16, 16);
    data[base] = 133;
    const paths = new LandPaths(map, false),
      owners = new Uint8Array(data.length);
    owners[base] = 1;
    expect(() =>
      startingResources(map, paths, [{ id: 1, base }], owners, [], [], 47, 1),
    ).not.toThrow();
  });
});
