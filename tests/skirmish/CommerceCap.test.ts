// Balance row "Trade tariff" part 3 (05 issue 4 / rec 3): a per-faction
// commerce cap. Only 3 + age-index factories and ports produce trade stock.
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  COMMERCE_PRODUCER_BASE,
  commerceProducerLimit,
  tradeStockPerSecond,
} from "../../src/skirmish/content/Economy";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function producers(age: Age, count: number) {
  const terrain = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const player = game.players[0];
  game.expansion!.progression.states[player.id].age = age;
  for (const b of game.buildings.filter(b => b.type === "factory" || b.type === "port")) game.removeBuilding(b.id);
  const ids = Array.from({ length: count }, (_, i) => game.addBuilding({
    id: game.allocateId(), playerId: player.id, type: "factory",
    tile: game.map.ref(10 + i * 6, 10), remainingTicks: 0, age,
  }).id);
  return { game, ids };
}

describe("commerce cap", () => {
  it("records the owner-decision limit (OD-5)", () => {
    expect(COMMERCE_PRODUCER_BASE).toBe(3);
    expect(AGES.map(commerceProducerLimit)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it.each(["StoneAge", "BronzeAge", "Modern"] as const)("stocks only %s's capped producers per second", age => {
    const limit = commerceProducerLimit(age);
    const { game, ids } = producers(age, limit + 2);
    for (let i = 0; i < secondsToTicks(1); i++) game.step();
    const stock = ids.map(id => game.expansion!.supply.goods.get(id) ?? 0);
    expect(stock.filter(n => n > 0)).toHaveLength(limit);
    expect(stock.reduce((a, b) => a + b, 0)).toBe(limit * tradeStockPerSecond(age));
  });
});
