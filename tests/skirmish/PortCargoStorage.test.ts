import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { secondsToTicks } from "../../src/skirmish/Protocol";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { packageTechnology } from "../../src/skirmish/content/Technology";

function fixture(stack = 1) {
  const terrain = new Uint8Array(80 * 50).fill(133);
  for (let y = 20; y < 30; y++) terrain.fill(0, y * 80, (y + 1) * 80);
  const game = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length),
    { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
  const e = game.expansion!;
  const research = e.progression.states[1].completed = [packageTechnology("StoneAge", "port-sea-trade")];
  const ports = Array.from({length: stack}, () => game.addBuilding({id: game.allocateId(),
    type: "port", playerId: 1, tile: game.map.ref(10, 19), age: "StoneAge", remainingTicks: 0}));
  const replenish = () => e.supply.step(secondsToTicks(1), game.players, game.buildings, game.owners, game.squads);
  const site = () => e.trade.siteSnapshot().find(s => s.naval && s.playerId === 1 && s.tile === ports[0].tile)!;
  return { game, e, research, ports, replenish, site };
}

it("grows storage with cargo research and publishes the same limit without changing factory storage", () => {
  const {game, e, research, ports, replenish, site} = fixture();
  const port = ports[0];
  const factory = game.addBuilding({id: game.allocateId(), type: "factory", playerId: 1,
    tile: game.map.ref(10, 15), age: "StoneAge", remainingTicks: 0});
  e.supply.goods.set(port.id, 1000);
  e.supply.goods.set(factory.id, 1000);
  replenish();
  expect(site()).toMatchObject({cargo: 20, maxCargo: 20, shipmentCapacity: 20});
  expect(e.supply.goods.get(factory.id)).toBe(1000);
  research.push(packageTechnology("StoneAge", "land-traders"));
  expect(site()).toMatchObject({cargo: 20, maxCargo: 25, shipmentCapacity: 25});
  replenish(); replenish(); replenish();
  expect(e.supply.goods.get(port.id)).toBe(25);
  const saved = game.checkpoint();
  game.restore(saved);
  expect(site()).toMatchObject({cargo: 25, maxCargo: 25, shipmentCapacity: 25});
});

it("tracks every age's trader, port and naval upgrades", () => {
  const {e, research, ports, replenish, site} = fixture();
  research.push(packageTechnology("StoneAge", "land-traders"));
  const beforeImprovement = [25, 39, 55, 71, 90, 109, 130, 151];
  const afterImprovement = [25, 43, 60, 80, 99, 120, 143, 168];
  for (const [i, age] of AGES.entries()) {
    if (i) research.push(packageTechnology(age, "ports"), packageTechnology(age, "sea-traders"));
    expect(site().maxCargo).toBe(beforeImprovement[i]);
    research.push(packageTechnology(age, i ? "ship-improvements" : "coastal-navigation"));
    e.supply.goods.set(ports[0].id, 1000);
    replenish();
    expect(site()).toMatchObject({cargo: afterImprovement[i], maxCargo: afterImprovement[i], shipmentCapacity: afterImprovement[i]});
  }
});

it("adds storage per stacked port and can accumulate a full stack-bonused shipment", () => {
  for (let stack = 1; stack <= 10; stack++) {
    const {e, research, ports, replenish, site} = fixture(stack);
    research.push(packageTechnology("StoneAge", "land-traders"));
    ports.forEach(p => e.supply.goods.set(p.id, 1000));
    replenish();
    expect(site().maxCargo).toBe(25 * stack);
    expect(site().cargo).toBe(site().maxCargo);
    expect(site().cargo).toBeGreaterThanOrEqual(site().shipmentCapacity);
  }
});
