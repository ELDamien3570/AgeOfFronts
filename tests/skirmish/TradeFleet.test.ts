import { isDeepStrictEqual } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  stackCargoPercent,
  TRADE_RULES,
} from "../../src/skirmish/content/Economy";
import { tradePayout } from "../../src/skirmish/domain/TradeQuote";
import { TradePayoutPresentation } from "../../src/skirmish/client/TradePayoutPresentation";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fleet(factories = 1, ports = 1, aiWarPolicy = false, deferredPlanning = false, tribe = false) {
  const terrain = new Uint8Array(120 * 80).fill(133);
  for (let y = 40; y < 50; y++) terrain.fill(0, y * 120, (y + 1) * 120);
  const game = new Skirmish(new GameMapImpl(120, 80, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: tribe,
    tribeCount: tribe ? 1 : undefined,
    runAi: false,
    ruleset: "ages-v1",
    aiWarPolicy,
    deferredPlanning,
  });
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  for (const s of game.squads)
    game.updateSquad(s.id, { x: 115 * FIXED, y: 70 * FIXED });
  game.owners.fill(1);
  const add = (
    type: "factory" | "city" | "port",
    x: number,
    y: number,
    playerId = 1,
  ) =>
    game.addBuilding({
      id: game.allocateId(),
      type,
      tile: game.map.ref(x, y),
      playerId,
      remainingTicks: 0,
      age: "StoneAge",
    });
  const sources = Array.from({ length: factories }, (_, i) =>
    add("factory", 10 + i, 10),
  );
  sources.push(
    ...Array.from({ length: ports }, (_, i) => add("port", 10 + i, 39)),
  );
  add("city", 70, 10);
  add("port", 100, 39, 2);
  add("city", 105, 15, 2);
  const expansion = game.expansion!,
    trade = expansion.trade;
  expansion.progression.states[1].completed.push(
    "rus-stoneage-land-traders",
    "rus-stoneage-port-sea-trade",
    "rus-stoneage-cities",
  );
  for (const source of sources) expansion.supply.goods.set(source.id, 1000);
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      game.tick++;
      trade.step();
    }
  };
  return { game, expansion, trade, sources, step };
}

describe("bounded civilian trade", () => {
  it.each([[false,false],[false,true],[true,false],[true,true]])("pays both participants equally and publishes the recipient's income label (naval=%s, allied=%s)",(naval,allied)=>{
    const {game,trade,step}=fleet(naval?0:1,naval?1:0);
    if(allied){
      game.expansion!.diplomacy.action(game.players[0],game.players[1],"offer",0);
      game.expansion!.diplomacy.action(game.players[1],game.players[0],"accept",0);
    }
    step(22);
    const actor=trade.actors.find(a=>a.playerId===1)!;
    const market=game.buildings.find(b=>b.playerId===2 && b.type===(naval?"port":"city"))!;
    const before=game.players.map(p=>p.gold);
    Object.assign(actor,{state:"outbound",destination:market.id,path:[],nextPathIndex:0,waitTicks:0,
      x:(game.map.x(market.tile)+.5)*FIXED,y:(game.map.y(market.tile)+.5)*FIXED});
    step();
    const income=game.players[0].gold-before[0];
    expect(income).toBeGreaterThan(0);
    expect(game.players[1].gold-before[1]).toBe(income);
    expect(trade.deliveredGold[1]).toBe(income);
    expect(trade.deliveredGold[2]).toBe(income);
    const snapshot=new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()));
    const receiverLabels=new TradePayoutPresentation();
    receiverLabels.update(snapshot.expansion!.tradeReceipts!,2,100);
    expect(receiverLabels.amount(market.tile,100)).toBe(income);
    // Visiting the same physical market again cannot repeat either payment.
    Object.assign(actor,{state:"outbound",destination:market.id,path:[],waitTicks:0});
    step();
    expect(game.players[0].gold-before[0]).toBe(income);
    expect(game.players[1].gold-before[1]).toBe(income);
  });
  it("pays domestic deliveries once rather than doubling the owner's income",()=>{
    const {game,trade,step}=fleet(1,0);step(22);
    const actor=trade.actors[0],market=game.buildings.find(b=>b.playerId===1 && b.type==="city")!;
    const before=game.players[0].gold;
    Object.assign(actor,{destination:market.id,path:[],waitTicks:0});step();
    expect(game.players[0].gold-before).toBe(actor.tripGold);
    expect(trade.deliveredGold[1]).toBe(actor.tripGold);
    expect([...trade.receipts.values()].filter(r=>r.tile===market.tile)).toHaveLength(1);
  });
  it("borrows land slots when paused and restores the reservation without interrupting sea voyages", () => {
    const {trade,step}=fleet(1,50);
    trade.setPaused(1,false,true);
    step(200);
    const sea=()=>trade.actors.filter(a=>a.playerId===1 && a.naval);
    expect(sea()).toHaveLength(48);
    const ships=sea().map(a=>a.id);
    trade.setPaused(1,false,false);
    step(20);
    expect(sea().map(a=>a.id)).toEqual(ships);
    expect(trade.actors.filter(a=>a.playerId===1 && !a.naval)).toHaveLength(0);
    // Complete eight voyages through the real returning/loading transition.
    for(const actor of sea().slice(-8))Object.assign(actor,{state:"returning",destination:actor.factoryId,
      path:[],nextPathIndex:0,waitTicks:0,cargo:0});
    step(40);
    expect(sea()).toHaveLength(40);
    expect(trade.actors.filter(a=>a.playerId===1 && !a.naval).length).toBeGreaterThan(0);
    expect(trade.actors.filter(a=>a.playerId===1).length).toBeLessThanOrEqual(48);
  });
  it("releases paused empty land couriers so their slots can be used at sea", () => {
    const {trade,step}=fleet(8,50);
    step(200);
    const land=trade.actors.filter(a=>a.playerId===1 && !a.naval);
    expect(land).toHaveLength(8);
    for(const actor of land)Object.assign(actor,{state:"loading",destination:null,path:[],cargo:0,waitTicks:0});
    trade.setPaused(1,false,true);
    step(40);
    expect(trade.actors.filter(a=>a.playerId===1 && !a.naval)).toHaveLength(0);
    expect(trade.actors.filter(a=>a.playerId===1 && a.naval)).toHaveLength(48);
  });
  it("reserves eight owner slots for factories even when ports fill first", () => {
    const {trade,expansion,sources,step}=fleet(1,50);
    expansion.supply.goods.set(sources[0].id,0);
    step(200);
    expect(trade.actors.filter(a=>a.playerId===1 && a.naval)).toHaveLength(40);
    expansion.supply.goods.set(sources[0].id,1000);
    step(200);
    expect(trade.actors.filter(a=>a.playerId===1 && !a.naval)).toHaveLength(8);
    expect(trade.actors.filter(a=>a.playerId===1)).toHaveLength(48);
  });
  it.each([false,true])("dispatches only a full load and permits additional couriers from one stocked site (naval=%s)", naval => {
    const {trade,expansion,sources,step}=fleet(naval?0:1,naval?1:0);
    expansion.supply.goods.set(sources[0].id,24);
    step(40);expect(trade.actors).toHaveLength(0);
    expansion.supply.goods.set(sources[0].id,25);
    step(22);expect(trade.actors).toHaveLength(1);
    expect(trade.actors[0].loaded).toBe(25);
    expect(expansion.supply.goods.get(sources[0].id)).toBe(0);
    expansion.supply.goods.set(sources[0].id,25);
    step(20);expect(trade.actors).toHaveLength(2);
    expect(trade.actors.every(a=>a.loaded===25)).toBe(true);
  });
  it("reuses a returning courier and tops up its unsold cargo before departure",()=>{
    const {game,trade,expansion,sources,step}=fleet(1,0);
    expansion.supply.goods.set(sources[0].id,25);step(22);
    const a=trade.actors[0],id=a.id;
    Object.assign(a,{state:"returning",destination:sources[0].id,path:[],waitTicks:0,cargo:15,delivered:10});
    step();expect(expansion.supply.goods.get(sources[0].id)).toBe(15);
    expansion.supply.goods.set(sources[0].id,24);step(40);
    expect(a.state).toBe("loading");expect(a.cargo).toBe(0);
    expect(game.snapshot().expansion!.traders.find(t=>t.id===id)?.waitingForCargo).toBe(true);
    expansion.supply.goods.set(sources[0].id,25);step(4);
    expect(trade.actors).toHaveLength(1);expect(a.id).toBe(id);
    expect(a.loaded).toBe(25);expect(a.tripSupplyTicks).toBeGreaterThan(0);
  });
  it("partially unloads a stacked ship once per unstacked port and returns unsold cargo", () => {
    const {game,trade,sources,expansion,step}=fleet(0,1,true);
    for(let i=0;i<9;i++) {
      const b=game.addBuilding({...sources[0],id:game.allocateId()});expansion.supply.goods.set(b.id,1000);
    }
    const first=game.buildings.find(b=>b.playerId===2 && b.type==="port")!;
    step(22);
    const a=trade.actors.find(a=>a.playerId===1)!;expect(a.loaded).toBe(75);
    const arrive=(b:typeof first)=>{
      a.state="outbound";a.destination=b.id;a.path=[];a.waitTicks=0;
      a.x=(game.map.x(b.tile)+.5)*FIXED;a.y=40.5*FIXED;step();
    };
    arrive(first);expect(a.delivered).toBe(30);expect(a.cargo).toBe(45);
    const gold=trade.deliveredGold[1];
    arrive(first);expect(a.delivered).toBe(30);expect(trade.deliveredGold[1]).toBe(gold);
    a.state="returning";a.destination=a.factoryId;a.path=[];a.waitTicks=0;step();
    expect(a.returned).toBe(45);
    expect(a.loaded).toBe(a.delivered+a.returned+a.lost+a.cargo);
  });
  it("finishes an accepted sea leg when war begins, but blocks new enemy voyages", () => {
    const {game,trade,step}=fleet(0,1,true);step(22);
    const a=trade.actors.find(a=>a.playerId===1)!;expect(a.cargo).toBeGreaterThan(0);
    expect(game.applyCommand({type:"alliance",playerId:1,otherId:2,action:"declare"})).toBeNull();
    a.waitTicks=0;a.path=[];step();
    expect(trade.deliveredGold[1]??0).toBeGreaterThan(0);
    step(22);
    expect(a.state).toBe("loading");
    expect(trade.controls[1]?.blocked ?? []).toEqual([]);
    expect(trade.permitted(1,2,true)).toBe(false);
  });
  it.each([false, true])("commits completed loading routes identically after cold restore (naval=%s)", (naval) => {
    const { game, trade, step } = fleet(naval ? 0 : 1, naval ? 1 : 0, false, true);
    step(20);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      trade.stepPlanning(1);
      game.routePlanner.step(++game.tick);
      ready = trade.checkpoint().admissions.some(([, plan]) => plan.loading && plan.outcome === "complete");
      if (ready) break;
    }
    expect(ready).toBe(true);
    const saved = game.checkpoint(), restored = new Skirmish(game.map, game.options);
    restored.restore(saved);
    expect(restored.checkpoint()).toEqual(saved);
    trade.stepPlanning(16);
    restored.expansion!.trade.stepPlanning(16);
    expect(trade.actors.some(a => a.state === "outbound" && a.cargo > 0)).toBe(true);
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });
  it.each(["loading", "outbound", "arrival", "returning", "capture", "source-loss"] as const)("continues trade identically across restore at %s", (phase) => {
    const { game, trade } = fleet(0, 1, false, true);
    const diplomacy=game.expansion!.diplomacy;
    expect(diplomacy.action(game.players[0],game.players[1],"offer",game.tick)).toBeNull();
    expect(diplomacy.action(game.players[1],game.players[0],"accept",game.tick)).toBeNull();
    let found = false;
    for (let i = 0; i < 2000; i++) {
      game.step();
      const a = trade.actors.find(a => a.naval);
      if (!a) continue;
      found = phase === "loading" ? a.state === "loading" :
        phase === "returning" ? a.state === "returning" :
        phase === "arrival" ? a.state === "outbound" && a.nextPathIndex >= a.path.length :
        a.state === "outbound" && a.nextPathIndex > 2 && a.cargo > 0;
      if (!found) continue;
      if (phase === "capture") {
        expect(diplomacy.action(game.players[1],game.players[0],"declare",game.tick)).toBeNull();
        a.waitTicks = 0;
        game.addShip({id: game.allocateId(), playerId: 2, kind: "warship", definitionId: "stoneage-warship", x:a.x,y:a.y,health:1000,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});
      }
      if (phase === "source-loss") game.removeBuilding(a.factoryId);
      break;
    }
    expect(found).toBe(true);
    const restored = new Skirmish(game.map, game.options);
    restored.restore(game.checkpoint());
    for (let i = 0; i < 120; i++) {
      game.step(); restored.step();
      expect(isDeepStrictEqual(restored.checkpoint(), game.checkpoint()), `first continuation difference at ${phase}, tick ${i + 1}`).toBe(true);
    }
    if (phase === "capture") expect(trade.capturedValue[2]).toBeGreaterThan(0);
  });
  it("dispatches trade and recruits ships from a valid bottom-edge coastal port", () => {
    const { game, trade, sources, step } = fleet(0, 1);
    for (const b of game.buildings.filter(b => b.type === "port"))
      game.updateBuilding(b.id, { tile: game.map.ref(game.map.x(b.tile), 38) });
    expect(game.map.neighbors(sources[0].tile).some(t => game.map.isWater(t))).toBe(false);
    step(22);
    expect(trade.actors.some(a => a.naval && a.cargo > 0)).toBe(true);
    game.expansion!.progression.states[1].completed.push("rus-stoneage-port-sea-trade");
    game.players[0].gold=100000;
    expect(game.applyCommand({type:"recruit-ship",playerId:1,buildingId:sources[0].id,shipType:"warship",definitionId:"stoneage-warship"})).toBeNull();
  });
  it("retires an orphaned source identically after cold restoration", () => {
    const {game,trade,sources,step}=fleet(0,1,false,true);
    step(20);
    game.removeBuilding(sources[0].id);
    step(401);
    expect(trade.actors.some(a=>a.factoryId===sources[0].id && a.state!=="prize")).toBe(false);
    const clone=new Skirmish(game.map,game.options);
    clone.restore(game.checkpoint());
    game.step();clone.step();
    expect(isDeepStrictEqual(game.checkpoint(),clone.checkpoint())).toBe(true);
  });
  it("captures a loaded ship without an owned receiving port, then delivers when one is built", () => {
    const { game, trade, step } = fleet(0, 1);
    step(22);
    const actor = trade.actors.find(a => a.naval)!;
    expect(actor.cargo).toBeGreaterThan(0);
    const cargoValue = actor.cargo * actor.valuePerGood;
    expect(game.expansion!.diplomacy.action(game.players[1],game.players[0],"declare",game.tick)).toBeNull();
    trade.setPaused(1,true,true);
    for (const port of game.buildings.filter(b => b.type === "port" && b.playerId === 2)) game.removeBuilding(port.id);
    game.addShip({ id: game.allocateId(), playerId: 2, kind: "warship", definitionId: "stoneage-warship", x: actor.x, y: actor.y, health: 1000, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false });
    actor.waitTicks = 0;
    step(25);
    expect(actor).toMatchObject({ playerId: 2, state: "prize", destination: null });
    expect(actor.cargo * actor.valuePerGood).toBe(cargoValue);
    expect(trade.deliveredGold[2] ?? 0).toBe(0);
    game.addBuilding({ id: game.allocateId(), type: "port", tile: game.map.ref(11, 39), playerId: 2, remainingTicks: 0, age: "StoneAge" });
    step(200);
    expect(trade.actors).not.toContain(actor);
    expect(trade.deliveredGold[2]).toBe(cargoValue);
  });
  it("makes merchant capture mutual after a player declares war on neutral AI", () => {
    const { game, trade, step } = fleet(0, 1, true);
    step(22);
    const actor = trade.actors.find(a => a.naval)!;
    const ship = game.addShip({ id: game.allocateId(), playerId: 2, kind: "warship", definitionId: "stoneage-warship", x: actor.x, y: actor.y, health: 1000, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false });
    actor.waitTicks = 0;
    step();
    expect(actor.playerId).toBe(1);
    expect(game.applyCommand({ type: "alliance", playerId: 1, otherId: 2, action: "declare" })).toBeNull();
    game.updateShip(ship.id, { x: actor.x, y: actor.y });
    step();
    expect(actor).toMatchObject({ playerId: 2, state: "prize" });
  });
  it.each(["eliminated", "no foreign port"] as const)("does not dispatch a tribe merchant when %s", (reason) => {
    const { game, expansion, trade, sources, step } = fleet(0, 1, false, false, true);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id });
    expansion.progression.states[tribe.id].completed.push("rus-stoneage-port-sea-trade");
    if (reason === "eliminated") tribe.eliminated = true;
    else for (const port of game.buildings.filter((b) => b.type === "port"))
      game.updateBuilding(port.id, { playerId: tribe.id });
    step(40);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(0);
  });
  it("lets a researched tribe dispatch full loads from a shared stacked port", () => {
    const { game, expansion, trade, sources, step } = fleet(0, 2, false, false, true);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    expect(tribe).toBeDefined();
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id, tile: sources[0].tile });
    const destination = game.buildings.find((b) => b.type === "port" && !sources.includes(b))!;
    game.updateBuilding(destination.id, { playerId: 1 });
    const research = expansion.progression.states[tribe.id].completed;
    research.splice(0, research.length);
    step(20);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(0);
    research.push("rus-stoneage-port-sea-trade");
    step(20);
    const actors = trade.actors.filter((a) => a.playerId === tribe.id);
    // Two stacked ports share one physical spawn site, not two timers.
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({ naval: true, definitionId: "stoneage-trade" });
    const origin = { x: actors[0].x, y: actors[0].y };
    step(19);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(1);
    step();
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(2);
    step(1800);
    expect(Math.hypot(actors[0].x - origin.x, actors[0].y - origin.y)).toBeGreaterThan(FIXED);
    expect(trade.deliveredGold[tribe.id]).toBeGreaterThan(0);
  });
  it("includes age-scaled tribe pools in the global ceiling while regular pools remain 48", () => {
    const { game, expansion, trade, sources, step } = fleet(40, 20, false, false, true);
    step(20);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(48);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    game.players.find((p) => p.id === 2)!.eliminated = true;
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id });
    const destination = game.buildings.find((b) => b.type === "port" && !sources.includes(b))!;
    game.updateBuilding(destination.id, { playerId: 1 });
    expansion.progression.states[tribe.id].completed.push("rus-stoneage-land-traders", "rus-stoneage-port-sea-trade");
    step(20);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(16);
    step(800);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(16);
    expect(trade.actors.length).toBeLessThanOrEqual(48 + 16);
    expansion.progression.states[tribe.id].age = "BronzeAge";
    step(800);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(18);
    expect(trade.actors.length).toBeLessThanOrEqual(48 + 18);
  });
  it("retains failed-corridor backoff across admissions and restore without loading or losing cargo", () => {
    const {game,trade,step,sources,expansion}=fleet(1,0,false,true);
    trade.setBlocked(1,2,true,false);
    const tasks:Parameters<NonNullable<typeof game.domainRoutes>["request"]>[0][]=[];
    const request=vi.spyOn(game.domainRoutes!,"request").mockImplementation(task=>{tasks.push(task);return true;});
    step(20);trade.stepPlanning(32);
    expect(tasks).toHaveLength(1);
    trade.completedRoute(tasks[0],"limited",[]);
    trade.stepPlanning(32);
    expect(trade.actors[0].cargo).toBe(0);
    expect(expansion.supply.goods.get(sources[0].id)).toBe(1000);
    expect(trade.checkpoint().routeFailures).toHaveLength(1);
    trade.restore(trade.checkpoint());
    step(300);trade.stepPlanning(32);
    expect(request).toHaveBeenCalledTimes(1);
    step(200);trade.stepPlanning(32);
    expect(request.mock.calls.length).toBeGreaterThan(1);
  });
  it("leaves an unrelated active fleet alone when pausing or blocking trade", () => {
    const { trade, step } = fleet(1, 1);
    step(100);
    const sea = trade.actors.find((a) => a.playerId === 1 && a.naval)!;
    const land = trade.actors.find((a) => a.playerId === 1 && !a.naval)!;
    expect(sea.state).toBe("outbound");
    expect(land.state).toBe("outbound");
    const voyage = structuredClone(sea);
    trade.setPaused(1, false, true);
    expect(sea).toEqual(voyage);
    expect(land.state).toBe("returning");
    const returning = structuredClone(land);
    trade.setBlocked(1, 2, true);
    expect(sea.state).toBe("outbound");
    expect(land).toEqual(returning);
  });
  it("visits nearby neutral AI markets, with capture beginning only on active war or retaliation", () => {
    const { game, trade, expansion, step } = fleet(1, 0, true);
    const adjacency = vi.spyOn(game, "factionAdjacent").mockReturnValue(true);
    const market = game.addBuilding({
      id: game.allocateId(),
      type: "city",
      tile: game.map.ref(15, 10),
      playerId: 2,
      remainingTicks: 0,
      age: "StoneAge",
    });
    step(22);
    const actor = trade.actors.find((a) => a.playerId === 1)!;
    expect(actor.destination).toBe(market.id);
    const captor = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(captor.id, { x: actor.x, y: actor.y });
    actor.waitTicks = 0;
    step();
    expect(actor.playerId).toBe(1);
    const operations = expansion.operations.checkpoint();
    operations.records = [
      [
        2,
        {
          phase: "war",
          target: 1,
          since: game.tick,
          nextThink: game.tick + 100,
          threats: [],
          cursor: 0,
          score: 0,
        },
      ],
    ];
    expansion.operations.restore(operations);
    game.updateSquad(captor.id, { x: actor.x, y: actor.y });
    actor.waitTicks = 0;
    step();
    expect(actor.playerId).toBe(2);
    expect(actor.state).toBe("prize");
    adjacency.mockRestore();
  });
  it("allows non-allied human markets while the pair is neutral", () => {
    const { game, trade, step } = fleet(1, 0, true);
    game.setAiController(2, false);
    const adjacency = vi.spyOn(game, "factionAdjacent").mockReturnValue(true);
    const market = game.addBuilding({
      id: game.allocateId(),
      type: "city",
      tile: game.map.ref(15, 10),
      playerId: 2,
      remainingTicks: 0,
      age: "StoneAge",
    });
    step(22);
    expect(trade.actors.find((a) => a.playerId === 1)!.destination).toBe(
      market.id,
    );
    adjacency.mockRestore();
  });
  it("caps a stocked sixty-level economy at 48 couriers", () => {
    const { trade, step } = fleet(40, 20);
    step(20);
    expect(trade.actors.filter(a=>a.playerId===1)).toHaveLength(48);
    step(800);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(
      TRADE_RULES.actorCap,
    );
  });
  it("requires replacement cargo after capture and continues identically after restoration", () => {
    const { game, trade, sources, expansion, step } = fleet(0, 1);
    step(20);
    game.updateBuilding(
      game.buildings.find((b) => b.type === "port" && b.playerId === 2)!.id,
      { tile: game.map.ref(25, 39) },
    );
    const actor = trade.actors[0];
    expect(actor.naval).toBe(true);
    // Replacement waits for another full load. The prize retires after delivery.
    expansion.supply.goods.set(sources[0].id,0);
    actor.cargo = 20;
    actor.loaded = 20;
    actor.state = "prize";
    actor.playerId = 2;
    actor.destination = null;
    actor.path = [];
    actor.waitTicks = 0;
    const saved = game.checkpoint(),
      clone = new Skirmish(game.map, game.options);
    clone.restore(saved);
    step(399);
    for (let i = 0; i < 399; i++) {
      clone.tick++;
      clone.expansion!.trade.step();
    }
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(0);
    expect(clone.expansion!.trade.checkpoint()).toEqual(trade.checkpoint());
    expect(trade.actors).not.toContain(actor);
    expect(trade.deliveredGold[2]).toBe(400);
    expansion.supply.goods.set(sources[0].id,25);
    step();
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(1);
    expect(expansion.supply.goods.get(sources[0].id)).toBeLessThanOrEqual(1000);
  });
  it("bounds stack cargo with diminishing returns and a level-ten ceiling", () => {
    const levels = Array.from({ length: 10 }, (_, i) =>
      stackCargoPercent(i + 1),
    );
    expect(levels[0]).toBe(100);
    expect(levels[9]).toBe(300);
    expect(stackCargoPercent(30)).toBe(300);
    expect(levels[1] - levels[0]).toBeGreaterThan(levels[9] - levels[8]);
    const { game, trade, sources, step } = fleet(0, 1);
    for (let i = 0; i < 9; i++)
      game.addBuilding({ ...sources[0], id: game.allocateId() });
    step(20);
    expect(trade.actors[0].capacity).toBe(75);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(1);
  });
  it("uses age-independent 1:1.5:2 land pricing and bounded per-good sea pricing", () => {
    const base = {
      naval: false,
      quantity: 20,
      valuePerGood: 5,
      distance: 1,
      foreign: false,
      allied: false,
      mapWidth: 500,
    };
    expect(tradePayout(base)).toBe(100);
    expect(tradePayout({ ...base, distance: 300 })).toBe(100);
    expect(tradePayout({ ...base, foreign: true, allied: true })).toBe(150);
    expect(tradePayout({ ...base, foreign: true })).toBe(200);
    expect(tradePayout({ ...base, naval: true })).toBe(0);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 0 }),
    ).toBe(150);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 2.5 }),
    ).toBe(157);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 5 }),
    ).toBe(165);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 500 }),
    ).toBe(300);
  });
  it("finishes launched sea cargo before pausing, blocks new voyages both ways, and replicates controls", () => {
    const { game, trade, step } = fleet(0, 1);
    step(22);
    const actor = trade.actors[0];
    expect(actor.cargo).toBeGreaterThan(0);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.snapshot()));
    expect(
      game.applyCommand({
        type: "trade-pause",
        playerId: 1,
        naval: true,
        paused: true,
      }),
    ).toBeNull();
    step(900);
    expect(actor.cargo).toBe(0);
    expect(actor.returned + actor.delivered).toBe(actor.loaded);
    expect(trade.deliveredGold[1] ?? 0).toBeGreaterThan(0);
    expect(
      game.applyCommand({
        type: "trade-block",
        playerId: 1,
        otherId: 2,
        blocked: true,
      }),
    ).toBeNull();
    expect(trade.permitted(1, 2)).toBe(false);
    expect(trade.permitted(2, 1)).toBe(false);
    const decoded = decoder.decode(encoder.encode(game.snapshot()));
    expect(decoded.expansion!.tradeControls![1]).toEqual({
      landPaused: false,
      seaPaused: true,
      blocked: [2],
      landBlocked: [2],
      seaBlocked: [2],
    });
    expect(
      commandSchema.safeParse({
        type: "trade-pause",
        playerId: 1,
        naval: true,
        paused: "yes",
      }).success,
    ).toBe(false);
    const clone = new Skirmish(game.map, game.options);
    clone.restore(game.checkpoint());
    expect(clone.expansion!.trade.controls).toEqual(trade.controls);
  });
  it("reuses route corridors without consuming another factory's goods for sea trade", () => {
    const { trade, expansion, sources, step } = fleet(1, 1);
    trade.setPaused(1, false, true);
    step(6000);
    expect(expansion.supply.goods.get(sources[0].id)).toBe(1000);
    expect(trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(trade.diagnostics.routeHits).toBeGreaterThan(0);
    expect(trade.diagnostics.routeRequests).toBeLessThan(10);
  });
});
