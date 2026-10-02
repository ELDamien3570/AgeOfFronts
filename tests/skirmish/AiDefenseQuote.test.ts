import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  buildingCost,
  buildingTicks,
} from "../../src/skirmish/content/Buildings";
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
  game.buildings.length = 0;
  game.expansion!.supply.deposits.length = 0;
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
describe("exact funded defense quotation", () => {
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
