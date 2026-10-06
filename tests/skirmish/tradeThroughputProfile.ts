import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const label = process.argv[2] ?? "current", ticks = Number(process.argv[3] ?? 12000);
const width = 500, height = 180, terrain = new Uint8Array(width * height).fill(133);
terrain.fill(0, 100 * width, 150 * width);
const game = new Skirmish(new GameMapImpl(width, height, terrain, terrain.length), {
  seed: 42, aiCount: 7, tribes: false, runAi: false, ruleset: "ages-v1", startingAge: "Modern",
});
game.owners.fill(1);
for (const a of game.players) for (const b of game.players) if (a.id < b.id) {
  game.expansion!.diplomacy.action(a, b, "offer", 0);
  game.expansion!.diplomacy.action(b, a, "accept", 0);
}
const sources: number[] = [];
for (const [at, p] of game.players.entries()) for (let i = 0; i < 8; i++) {
  for (const type of ["factory", "port", "city"] as const) for (let stack = 0; stack < 3; stack++) {
    const b = game.addBuilding({ id: game.allocateId(), type, playerId: p.id, age: "Modern", remainingTicks: 0,
      tile: game.map.ref(10 + at * 58 + i * 5, type === "port" ? 99 : type === "city" ? 83 : 80) });
    if (type !== "city") sources.push(b.id);
  }
}
const trade = game.expansion!.trade, times: number[] = [];
let requests = 0, reads = 0;
for (let i = 0; i < ticks; i++) {
  game.tick++;
  if (i % 20 === 0) for (const id of sources) game.expansion!.supply.goods.set(id,
    Math.min(1000, (game.expansion!.supply.goods.get(id) ?? 0) + 14));
  const start = performance.now(); trade.step();
  if (i >= 1000) times.push(performance.now() - start);
  requests = trade.diagnostics.routeRequests; reads = trade.diagnostics.marketReads;
}
const cold = new Skirmish(game.map, game.options); cold.restore(game.checkpoint());
for (let i = 0; i < 100; i++) { game.tick++; cold.tick++; trade.step(); cold.expansion!.trade.step(); }
if (!isDeepStrictEqual(trade.checkpoint(), cold.expansion!.trade.checkpoint())) throw new Error("Trade cold restore diverged");
times.sort((a, b) => a - b);
const result = { label, ticks, actors: trade.actors.length, meanMs: times.reduce((a,b)=>a+b,0)/times.length,
  p95Ms: times[Math.floor(times.length*.95)], p99Ms: times[Math.floor(times.length*.99)], requests, reads,
  gold: trade.deliveredGold, coldRestore: "equal" };
writeFileSync(`out/trade-${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
