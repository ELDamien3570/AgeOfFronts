import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
export function seaFleet(sources = 1, markets = 1) {
  const width = Math.max(160, sources * 4 + 30, markets * 5 + 130), height = 80, terrain = new Uint8Array(width * height).fill(133);
  for (let y = 40; y < 50; y++) terrain.fill(0, y * width, (y + 1) * width);
  const map = () => new GameMapImpl(width, height, terrain.slice(), terrain.length);
  const options = { seed: 42, aiCount: 2, runAi: false, tribes: false, ruleset: "ages-v1" as const,
    deferredPlanning: true, seaTradeRouting: "lanes-v1" as const };
  const game = new Skirmish(map(), options);
  for (const building of [...game.buildings]) game.removeBuilding(building.id);
  for (const squad of [...game.squads]) game.removeSquad(squad.id);
  const add = (type: "port" | "city", x: number, y: number, playerId: number) => game.addBuilding({
    id: game.allocateId(), type, tile: game.map.ref(x, y), playerId, remainingTicks: 0, age: "StoneAge" });
  const ports = Array.from({ length: sources }, (_, i) => add("port", 10 + i * 4, 39, 1));
  const receivers = Array.from({ length: markets }, (_, i) => add("port", 100 + i * 5, 50, 2 + i % 2));
  for (let owner = 1; owner <= 3; owner++) add("city", 10 + owner * 10, 20, owner);
  game.owners.fill(1);
  const expansion = game.expansion!;
  expansion.progression.states[1].completed.push("rus-stoneage-port-sea-trade");
  for (const port of ports) expansion.supply.goods.set(port.id, 1000);
  const step = (ticks = 1) => { for (let i = 0; i < ticks; i++) game.step(); };
  return { game, map, options, expansion, trade: expansion.trade, ports, receivers, step, FIXED };
}
