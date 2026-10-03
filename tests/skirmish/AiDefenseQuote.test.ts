import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { BuildingIndex } from "../../src/skirmish/BuildingIndex";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  buildingCost,
  buildingTicks,
} from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import {
  quoteAiDefense,
  rectangularDefensePerimeter,
  type AiDefenseSite,
} from "../../src/skirmish/domain/AiDefenseQuote";

function fixture() {
  const map = new GameMapImpl(96, 64, new Uint8Array(6144).fill(133), 6144),
    game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
  game.owners.fill(1);
  for (const building of game.buildings) game.removeBuilding(building.id);
  game.expansion!.supply.replaceDeposits([]);
  game.expansion!.supply.resourceSites.update([]);
  return {
    map,
    game,
    input: {
      map,
      owners: game.owners,
      player: game.players[0],
      age: "Modern" as const,
      buildings: game.buildings,
      fortifications: game.expansion!.fortifications,
      diplomacy: game.expansion!.diplomacy,
      resources: game.expansion!.supply.resourceSites,
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("exact funded defense quotation", () => {
  it("uses live spatial facts without cloning or rebuilding the full world and matches real sequential wall payments", () => {
    const { map, game, input } = fixture();
    game.players[0].gold = 100000;
    game.expansion!.progression.states[1].completed.push(
      ...TECHNOLOGIES.filter((t) => t.age === "StoneAge").map((t) => t.id),
    );
    const live = game.buildingFacts(),
      rebuild = vi.spyOn(BuildingIndex.prototype, "rebuild"),
      checkpoint = vi.spyOn(input.fortifications, "checkpoint");
    const sites: AiDefenseSite[] = [
      [10, 10],
      [22, 10],
      [22, 22],
      [10, 22],
    ].map(([x, y]) => ({ type: "tower", tile: map.ref(x, y) }));
    const quote = quoteAiDefense({
      ...input,
      age: "StoneAge",
      buildingFacts: live,
      sites,
    });
    if (typeof quote === "string") throw Error(quote);
    expect(rebuild).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    const gold = game.players[0].gold;
    for (const step of quote.steps) {
      expect(
        game.applyCommand({
          type: "build",
          playerId: 1,
          buildingType: step.type,
          tile: step.tile,
          age: "StoneAge",
        }),
      ).toBeNull();
      const building = game.buildingsAt(step.tile)[0];
      game.updateBuilding((building).id, { remainingTicks: 0 });
      input.fortifications.step(game.tick, game.buildings);
    }
    expect(gold - game.players[0].gold).toBe(quote.cost.gold);
    expect(
      input.fortifications.barriers
        .flatMap((b) => b.tiles)
        .sort((a, b) => a - b),
    ).toEqual(
      quote.steps
        .flatMap((s) => s.links.flatMap((l) => l.tiles))
        .sort((a, b) => a - b),
    );
  });
  it("quotes the plan's full Modern count-scaled examples without mutating the live world", () => {
    const { map, game, input } = fixture(),
      sites: AiDefenseSite[] = [];
    for (let i = 0; i < 2; i++)
      sites.push({ type: "trench", tile: map.ref(5 + i * 4, 10) });
    sites.push({ type: "gun-nest", tile: map.ref(13, 10) });
    const before = game.checkpoint(),
      quote = quoteAiDefense({ ...input, sites });
    expect(typeof quote).toBe("object");
    if (typeof quote === "string") throw new Error(quote);
    expect(quote.cost).toEqual({ gold: 49980, items: { steel: 40 } });
    expect(quote.steps[1].ticks).toBe(buildingTicks("trench", 1));
    expect(quote.steps[2].earliestStart).toBe(
      quote.steps[0].ticks + quote.steps[1].ticks,
    );
    expect(game.checkpoint()).toEqual(before);
    const large = quoteAiDefense({
      ...input,
      sites: Array.from({ length: 9 }, (_, i) => ({
        type: i < 6 ? "trench" : "gun-nest",
        tile: map.ref(5 + i * 4, 15),
      })),
    });
    if (typeof large === "string") throw new Error(large);
    expect(large.cost).toEqual({ gold: 214200, items: { steel: 156 } });
  });
  it("retains corners, evenly spaces side towers and includes actual automatic wall payment", () => {
    const { map, input } = fixture(),
      bounds = { left: 10, top: 10, right: 34, bottom: 34 };
    const tiles = rectangularDefensePerimeter(map, bounds)!;
    for (const [x, y] of [
      [10, 10],
      [34, 10],
      [34, 34],
      [10, 34],
    ])
      expect(tiles).toContain(map.ref(x, y));
    for (let i = 0; i < tiles.length; i++)
      expect(
        map.manhattanDist(tiles[i], tiles[(i + 1) % tiles.length]),
      ).toBeLessThanOrEqual(12);
    const quote = quoteAiDefense({
      ...input,
      age: "StoneAge",
      sites: tiles.map((tile) => ({ type: "tower", tile })),
      allowedWall: (tile) =>
        map.x(tile) === 10 ||
        map.x(tile) === 34 ||
        map.y(tile) === 10 ||
        map.y(tile) === 34,
    });
    if (typeof quote === "string") throw new Error(quote);
    const towerGold = quote.steps.reduce(
      (n, _, i) => n + buildingCost("tower", "StoneAge", i).gold!,
      0,
    );
    expect(quote.cost.gold).toBeGreaterThan(towerGold);
    expect(quote.steps[quote.steps.length - 1].links).toHaveLength(2);
  });
});
