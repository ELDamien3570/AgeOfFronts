import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { secondsToTicks } from "../../src/skirmish/Protocol";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { packageTechnology } from "../../src/skirmish/content/Technology";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { PORT_CARGO_REPLENISH_SECONDS } from "../../src/skirmish/content/Economy";

function fixture(stack = 1, kind: "port" | "factory" = "port") {
  const terrain = new Uint8Array(80 * 50).fill(133);
  for (let y = 20; y < 30; y++) terrain.fill(0, y * 80, (y + 1) * 80);
  const game = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length),
    { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
  const e = game.expansion!;
  const research = e.progression.states[1].completed = [packageTechnology("StoneAge", "port-sea-trade")];
  const ports = Array.from({length: stack}, () => game.addBuilding({id: game.allocateId(),
    type: kind, playerId: 1, tile: game.map.ref(10, kind === "port" ? 19 : 15), age: "StoneAge", remainingTicks: 0}));
  let elapsedTicks = 0;
  const replenish = (seconds = 1) => {
    for (let n = 0; n < secondsToTicks(seconds); n++)
      e.supply.step(++elapsedTicks, game.players, game.buildings, game.owners, game.squads, {buildings:game.buildingFacts(),squads:game.squadFacts()});
  };
  const site = () => e.trade.siteSnapshot().find(s => s.naval === (kind === "port") && s.playerId === 1 && s.tile === ports[0].tile)!;
  return { game, e, research, ports, replenish, site };
}

it("grows storage with cargo research and publishes matching factory and port limits", () => {
  const {game, e, research, ports, replenish, site} = fixture();
  const port = ports[0];
  const factory = game.addBuilding({id: game.allocateId(), type: "factory", playerId: 1,
    tile: game.map.ref(10, 15), age: "StoneAge", remainingTicks: 0});
  e.supply.goods.set(port.id, 1000);
  e.supply.goods.set(factory.id, 1000);
  replenish();
  expect(site()).toMatchObject({cargo: 20, maxCargo: 20, shipmentCapacity: 20});
  expect(e.supply.goods.get(factory.id)).toBe(20);
  research.push(packageTechnology("StoneAge", "land-traders"));
  expect(site()).toMatchObject({cargo: 20, maxCargo: 25, shipmentCapacity: 25});
  replenish(PORT_CARGO_REPLENISH_SECONDS);
  expect(e.supply.goods.get(port.id)).toBe(25);
  const saved = game.checkpoint();
  game.restore(saved);
  expect(site()).toMatchObject({cargo: 25, maxCargo: 25, shipmentCapacity: 25});
});

it.each(AGES)("replenishes exactly one current %s port capacity in 104 ticks (13 seconds) using whole goods", age => {
  const {e, research, ports, replenish} = fixture();
  research.splice(0, research.length, ...TECHNOLOGIES.filter(t => AGES.indexOf(t.age) <= AGES.indexOf(age)).map(t => t.id));
  const capacity = e.supply.goodsCapacity(ports[0]);
  replenish(PORT_CARGO_REPLENISH_SECONDS - 1);
  expect(e.supply.goods.get(ports[0].id)).toBe(Math.floor(capacity * 12 / 13));
  expect(Number.isInteger(e.supply.goods.get(ports[0].id))).toBe(true);
  replenish();
  expect(e.supply.goods.get(ports[0].id)).toBe(capacity);
  replenish(20);
  expect(e.supply.goods.get(ports[0].id)).toBe(capacity);
});

it("preserves fractional refill through restore and resets it on capture for shared cargo producers", () => {
  const {game, e, research, ports, replenish} = fixture();
  research.push(packageTechnology("StoneAge", "land-traders"));
  const factory = game.addBuilding({id:game.allocateId(), playerId:1, type:"factory", tile:game.map.ref(10,15), age:"StoneAge", remainingTicks:0});
  replenish(3);
  expect(e.supply.goods.get(ports[0].id)).toBe(5);
  expect(e.supply.goods.get(factory.id)).toBe(7);
  const saved = e.supply.checkpoint();
  replenish();
  const expected = e.supply.checkpoint();
  e.supply.restore(saved);
  replenish();
  expect(e.supply.checkpoint()).toEqual(expected);
  expect(e.supply.goods.get(ports[0].id)).toBe(7);
  replenish(3);
  game.updateBuilding(ports[0].id, {playerId:game.players[1].id});
  replenish();
  expect(e.supply.goods.get(ports[0].id)).toBe(1);
});

it("restores legacy supply checkpoints without refill progress and clears progress when a port is removed", () => {
  const {e, research, ports, replenish} = fixture();
  research.push(packageTechnology("StoneAge", "land-traders"));
  replenish(3);
  const legacy = e.supply.checkpoint();
  Reflect.deleteProperty(legacy, "goodsRefillRemainders");
  e.supply.restore(legacy);
  replenish();
  expect(e.supply.goods.get(ports[0].id)).toBe(6);
  e.supply.forgetProducer(ports[0].id);
  expect(e.supply.checkpoint().goodsRefillRemainders.has(ports[0].id)).toBe(false);
});

it("replenishes each stacked port independently rather than multiplying one shared timer", () => {
  const {ports, replenish, site} = fixture(3);
  replenish(12);
  expect(site().cargo).toBe(ports.length * Math.floor(20 * 12 / 13));
  replenish();
  expect(site().cargo).toBe(ports.length * 20);
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


it.each(AGES)("replenishes one current %s factory load in exactly 80 ticks and caps idle stock", age => {
  const {e,research,ports,replenish,site} = fixture(1,"factory");
  research.splice(0,research.length,...TECHNOLOGIES.filter(t=>AGES.indexOf(t.age)<=AGES.indexOf(age)).map(t=>t.id));
  const source=ports[0],capacity=e.supply.goodsCapacity(source);
  replenish(79/8);
  expect(e.supply.goods.get(source.id)).toBe(Math.floor(capacity*79/80));
  replenish(1/8);
  expect(site()).toMatchObject({cargo:capacity,maxCargo:capacity,shipmentCapacity:capacity});
  replenish(40);
  expect(e.supply.goods.get(source.id)).toBe(capacity);
  // Draining at a non-second boundary must still require 80 full ticks.
  replenish(3/8);
  e.supply.goods.set(source.id,0);
  replenish(79/8);
  expect(e.supply.goods.get(source.id)).toBeLessThan(capacity);
  replenish(1/8);
  expect(e.supply.goods.get(source.id)).toBe(capacity);
});

it("refills stacked factories independently with shared shipment bonuses and checkpointed fractions",()=>{
  const {e,research,ports,replenish,site}=fixture(3,"factory");
  research.push(packageTechnology("StoneAge","land-traders"));
  replenish(3/8);
  const saved=e.supply.checkpoint();
  replenish(77/8);
  const expected=e.supply.checkpoint();
  expect(site().cargo).toBe(75);
  expect(site().shipmentCapacity).toBeLessThan(site().cargo);
  e.supply.restore(saved);
  replenish(77/8);
  expect(e.supply.checkpoint()).toEqual(expected);
  e.supply.forgetProducer(ports[0].id);
  expect(e.supply.goods.has(ports[0].id)).toBe(false);
  expect(e.supply.checkpoint().goodsRefillRemainders.has(ports[0].id)).toBe(false);
});

it("migrates legacy per-second fractional port refill without losing progress",()=>{
  const {e,research,ports,replenish}=fixture();
  research.push(packageTechnology("StoneAge","land-traders"));
  const legacy=e.supply.checkpoint();
  Reflect.deleteProperty(legacy, "goodsRefillDenominator");
  legacy.goods.set(ports[0].id,3);
  legacy.goodsOwners.set(ports[0].id,1);
  legacy.goodsRefillRemainders.set(ports[0].id,15);
  e.supply.restore(legacy);
  replenish();
  expect(e.supply.goods.get(ports[0].id)).toBe(5);
});


it("physically dispatches full factory loads no faster than one per 80 ticks",()=>{
  const {game,e,research,ports}=fixture(1,"factory");
  research.push(packageTechnology("StoneAge","land-traders"));
  game.owners.fill(1);
  const dispatched=new Map<number,number>();
  for(let tick=1;tick<=800;tick++){
    game.tick=tick;
    e.supply.step(tick,game.players,game.buildings,game.owners,game.squads);
    e.trade.step();
    for(const actor of e.trade.actors)
      if(!actor.naval && actor.factoryId===ports[0].id && actor.shipmentId>0 && actor.loaded>0)
        dispatched.set(actor.shipmentId,actor.tripStartedTick!);
    if(tick<80)expect(dispatched.size).toBe(0);
  }
  const starts=[...dispatched.values()].sort((a,b)=>a-b);
  expect(starts.length).toBeGreaterThanOrEqual(3);
  expect(starts[0]).toBeGreaterThanOrEqual(80);
  for(let i=1;i<starts.length;i++)expect(starts[i]-starts[i-1]).toBeGreaterThanOrEqual(80);
});


it("drops old factory cargo and fractional progress when ownership changes",()=>{
  const {game,e,research,ports,replenish}=fixture(1,"factory");
  research.push(packageTechnology("StoneAge","land-traders"));
  replenish(3);
  expect(e.supply.goods.get(ports[0].id)).toBe(7);
  game.updateBuilding(ports[0].id,{playerId:2});
  replenish(1/8);
  expect(e.supply.goods.get(ports[0].id)).toBe(0);
  expect(e.supply.goodsCapacity(ports[0])).toBe(20);
  replenish(7/8);
  expect(e.supply.goods.get(ports[0].id)).toBe(2);
  e.supply.goods.set(ports[0].id,1000);
  replenish(1/8);
  expect(e.supply.goods.get(ports[0].id)).toBe(20);
});


it.each(["port","factory"] as const)("migrates old 160-tick fractional progress for %s exactly",kind=>{
  const {e,research,ports,replenish}=fixture(1,kind);
  research.push(packageTechnology("StoneAge","land-traders"));
  const legacy=e.supply.checkpoint();
  legacy.goodsRefillDenominator=160;
  legacy.goods.set(ports[0].id,3);
  legacy.goodsOwners.set(ports[0].id,1);
  legacy.goodsRefillRemainders.set(ports[0].id,120);
  e.supply.restore(legacy);
  expect(e.supply.checkpoint().goodsRefillRemainders.get(ports[0].id)! / e.supply.checkpoint().goodsRefillDenominator).toBe(.75);
  replenish(1/8);
  expect(e.supply.goods.get(ports[0].id)).toBe(kind==="port"?3:4);
});

it.each(["port","factory"] as const)("refills an idle %s at the promised rate through actual simulation ticks",kind=>{
  const {game,e,ports}=fixture(1,kind);
  e.trade.setPaused(1,kind==="port",true);
  const period=kind==="port"?104:80,capacity=e.supply.goodsCapacity(ports[0]);
  for(let n=0;n<period-1;n++)game.step();
  expect(e.supply.goods.get(ports[0].id)).toBe(Math.floor(capacity*(period-1)/period));
  game.step();
  expect(e.supply.goods.get(ports[0].id)).toBe(capacity);
});
