// Balance row "Stacking" (05 issue 5 / rec 4): per-type stack caps.
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  constructionRejection,
  MAX_BUILDING_STACK,
  STACK_LIMITS,
  stackLimit,
} from "../../src/skirmish/Construction";
import type { Building, BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const map = new GameMapImpl(64, 64, terrain, terrain.length);
  const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false });
  const player = game.players[0];
  game.owners.fill(player.id);
  player.gold = 1e9;
  return { game, map, player };
}
const stackOf = (type: BuildingType, tile: number, n: number, playerId: number): Building[] =>
  Array.from({ length: n }, (_, i) => ({ id: 1000 + i, tile, playerId, type, remainingTicks: 0 }));

describe("per-type stack limits", () => {
  it("records the owner-decision caps (OD-7)", () => {
    expect(STACK_LIMITS).toEqual({ mine: 1, city: 3, factory: 5, port: 5 });
    expect(stackLimit("barracks")).toBe(MAX_BUILDING_STACK);
    expect(stackLimit("oil-well")).toBe(MAX_BUILDING_STACK);
  });
  it.each([["city", 3], ["factory", 5], ["barracks", 15]] as const)(
    "accepts a %s stack below %i and rejects the next one",
    (type, limit) => {
      const { game, map, player } = fixture(), tile = map.ref(20, 20);
      const stack = stackOf(type, tile, limit - 1, player.id);
      expect(constructionRejection(map, game.owners, stack, player, type, tile)).toBeNull();
      stack.push({ ...stack[0], id: 2000 });
      expect(constructionRejection(map, game.owners, stack, player, type, tile))
        .toBe(`A single site can support at most ${limit} stacked buildings`);
    },
  );
  it("rejects a second mine on a deposit for a nation", () => {
    const { game, map, player } = fixture(), tile = map.ref(20, 20);
    expect(player.kind).toBe("regular");
    expect(constructionRejection(map, game.owners, stackOf("mine", tile, 1, player.id), player, "mine", tile, false))
      .toContain("cannot stack mines");
  });
  it("rejects a fourth city through the command path without spending gold", () => {
    const { game, map, player } = fixture(), tile = map.ref(30, 30);
    for (const b of game.buildings.filter(b => b.tile === tile)) game.removeBuilding(b.id);
    for (let i = 0; i < 3; i++)
      expect(game.applyCommand({ type: "build", playerId: player.id, buildingType: "city", tile })).toBeNull();
    const gold = player.gold, count = game.buildings.length;
    expect(game.applyCommand({ type: "build", playerId: player.id, buildingType: "city", tile }))
      .toBe("A single site can support at most 3 stacked buildings");
    expect(player.gold).toBe(gold);
    expect(game.buildings).toHaveLength(count);
  });
});
