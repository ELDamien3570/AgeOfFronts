import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { VESSEL } from "../../src/skirmish/content/Units";
import { navalPower } from "../../src/skirmish/domain/AiNavalPlanner";
import { NavalFactSequence } from "../../src/skirmish/domain/NavalFactSequence";

function fixture(split = false, compact = false, island = false) {
  const data = new Uint8Array(100 * 70).fill(133);
  for (let y = 20; y < (compact ? 36 : 70); y++)
    for (let x = 0; x < (compact ? 16 : 100); x++) data[y * 100 + x] = 0;
  if (split) for (let y = 20; y < 70; y++) data[y * 100 + 50] = 133;
  if(island){data.fill(0);for(let y=20;y<55;y++)for(let x=25;x<75;x++)data[y*100+x]=133;}
  const map = new GameMapImpl(100, 70, data, 2000),
    game = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      tribes: false,
      ruleset: "ages-v1",
      runAi: false,
      aiEconomy: true,
      aiNaval: true,
      deferredPlanning: true,
    }),
    player = game.players[1],
    expansion = game.expansion!;
  game.owners.fill(player.id);
  player.gold = 100000;
  expansion.progression.states[player.id].completed.push(
    ...TECHNOLOGIES.filter((t) => t.age === "StoneAge").map((t) => t.id),
  );
  const port = game.addBuilding({
    id: game.allocateId(),
    playerId: player.id,
    type: "port" as const,
    tile: island ? map.ref(25,30) : map.ref(10, 19),
    age: "StoneAge" as const,
    health: 1000,
    remainingTicks: 0,
  });

  const addShip = (owner = player.id, x = 10, health = 1000): Ship => {
    const ship: Ship = game.addShip({
      id: game.allocateId(),
      playerId: owner,
      kind: "warship",
      definitionId: "stoneage-warship",
      x: (x + 0.5) * FIXED,
      y: 21.5 * FIXED,
      health,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      repairState: "patrolling",
    });

    return ship;
  };
  game.restore(game.checkpoint());
  const facts = expansion.economy.navalFacts,
    planner = expansion.economy.naval;
  const refresh = () => {
    game.restore(game.checkpoint());
    const before = facts.diagnostics.passes;
    for (let i = 0; i < 100 && before === facts.diagnostics.passes; i++)
      facts.step(game.tick + 100, 32);
    expect(facts.diagnostics.passes).toBe(before + 1);
  };
  const assess = (budget = 3) => {
    for (let i = 0; i < 500; i++) {
      expect(planner.step(budget)).toBeLessThanOrEqual(budget);
      const mission = planner.missions.get(player.id);
      if (mission && !mission.assessment) return mission;
    }
    throw new Error("assessment did not finish");
  };
  return {
    game,
    map,
    get player() {
      return game.players[1];
    },
    expansion,
    port,
    facts,
    planner,
    addShip,
    refresh,
    assess,
  };
}
describe("persistent concentrated port defense", () => {
  it("covers different approaches around an island instead of clustering at its only port",()=>{
    const f=fixture(false,false,true);for(let i=0;i<32;i++)f.addShip();
    f.refresh();const groups=f.assess().patrolGroups!;
    expect(groups).toHaveLength(4);
    expect(groups.some(g=>f.map.x(g.anchor)<25)).toBe(true);
    expect(groups.some(g=>f.map.x(g.anchor)>=75)).toBe(true);
    expect(groups.some(g=>f.map.y(g.anchor)<20)).toBe(true);
    expect(groups.some(g=>f.map.y(g.anchor)>=55)).toBe(true);
  });
  it("divides a quiet navy into groups of at most eight covering separated coastal sectors",()=>{
    const f=fixture();for(let i=0;i<32;i++)f.addShip(f.player.id,10+i%4);
    f.refresh();const mission=f.assess();
    expect(mission.patrolGroups).toHaveLength(4);
    expect(mission.patrolGroups!.every(group=>group.members.length===8)).toBe(true);
    expect(new Set(mission.patrolGroups!.flatMap(group=>group.members)).size).toBe(32);
    expect(new Set(mission.patrolGroups!.map(group=>group.anchor)).size).toBe(4);
    expect(Math.max(...mission.patrolGroups!.map(group=>f.map.euclideanDistSquared(group.anchor,mission.anchor!)))).toBeGreaterThan(64**2);
    const saved=f.game.checkpoint(),cold=new Skirmish(f.map,f.game.options);cold.restore(saved);
    expect(cold.expansion!.economy.naval.missions.get(f.player.id)?.patrolGroups).toEqual(mission.patrolGroups);
    for(const group of mission.patrolGroups!)expect(group.members.map(id=>cold.expansion!.economy.naval.fleetLane(cold.ship(id)!))).toEqual([0,1,2,3,0,1,2,3]);
  });
  it("patrols friendly shore despite a stronger fleet elsewhere in the sea", () => {
    const f=fixture(); f.addShip();
    for(let i=0;i<6;i++)f.addShip(1,80+i);
    f.refresh();const mission=f.assess();
    expect(mission.state).toBe("stage");
    expect(mission.target).toBeUndefined();
    expect(mission.patrolRoute!.length).toBeGreaterThan(2);
    expect(f.map.euclideanDistSquared(mission.anchor!,mission.patrolGoal!)).toBeGreaterThan(16**2);
    for(const tile of mission.patrolRoute!) {
      expect(f.map.y(tile)).toBeLessThanOrEqual(22);
      expect(f.game.waterPaths.walkable(tile)).toBe(true);
    }
    const saved=f.game.checkpoint(); f.game.restore(saved);
    expect(f.game.expansion!.economy.naval.missions.get(f.player.id)?.patrolRoute).toEqual(mission.patrolRoute);
  });
  it("uses separate patrol arrival cells for small flotillas", () => {
    const f=fixture();for(let i=0;i<16;i++) {
      f.addShip(f.player.id,10+i%4);
      for(let j=0;j<3;j++)f.game.allocateId();
    }
    f.refresh(); const apply=vi.spyOn(f.game,"applyCommand"); f.assess();
    const sails=apply.mock.calls.map(([c])=>c).filter(c=>c.type==="sail");
    expect(sails).toHaveLength(4);
    expect(new Set(sails.map(c=>c.tile)).size).toBe(4);
    expect(sails.every(c=>c.shipIds.length===4)).toBe(true);
    const mission=f.planner.missions.get(f.player.id)!;
    expect(mission.members.slice(0,4).map(id=>f.planner.fleetLane(f.game.ship(id)!))).toEqual([0,1,2,3]);
    const saved=f.game.checkpoint(),cold=new Skirmish(f.map,f.game.options);cold.restore(saved);
    for(let i=0;i<350;i++){f.game.step();cold.step();}
    expect(cold.checkpoint()).toEqual(f.game.checkpoint());
    expect(f.game.ships.every(s=>f.map.euclideanDistSquared(f.game.tileOf(s),mission.anchor!)>12**2)).toBe(true);
  });
  it("keeps an outbound interception when healthy ships spread beyond the assembly radius", () => {
    const f=fixture(), first=f.addShip(), second=f.addShip(f.player.id,12), enemy=f.addShip(1,25);
    f.refresh();
    expect(f.assess().state).toBe("execute");
    f.game.updateShip(first.id,{x:40.5*FIXED,destination:null});
    f.game.updateShip(second.id,{x:52.5*FIXED,destination:null});
    f.game.updateShip(enemy.id,{x:70.5*FIXED});
    f.game.tick+=100;
    f.refresh();
    const apply=vi.spyOn(f.game,"applyCommand"),mission=f.assess();
    expect(mission.state).toBe("execute");
    const orders=apply.mock.calls.map(([c])=>c).filter(c=>c.type==="sail");
    expect(orders.some(c=>c.tile===f.map.ref(70,21))).toBe(true);
    expect(orders.some(c=>c.tile===mission.anchor)).toBe(false);
  });
  it("keeps a quiet offshore patrol active beyond the old port-defense timeout", () => {
    const f=fixture(),ship=f.addShip();
    f.refresh();
    let mission=f.assess();
    expect(f.map.euclideanDistSquared(mission.anchor!,mission.patrolGoal!)).toBeGreaterThanOrEqual(24**2);
    for(let i=0;i<10;i++) {
      const goal=mission.patrolGoal!;
      f.game.updateShip(ship.id,{x:(f.map.x(goal)+.5)*FIXED,y:(f.map.y(goal)+.5)*FIXED,destination:null});
      f.game.tick+=100;f.refresh();mission=f.assess();
      expect(mission.state).toBe("stage");
      expect(f.planner.allowsLocalPursuit(f.game.ship(ship.id)!)).toBe(true);
    }
  });
  it("uses a shorter patrol leg when the sea cannot fit an offshore leg", () => {
    const f=fixture(false,true);f.addShip();f.refresh();
    const mission=f.assess();
    expect(f.map.euclideanDistSquared(mission.anchor!,mission.patrolGoal!)).toBeGreaterThan(3**2);
    expect(f.game.waterPaths.walkable(mission.patrolGoal!)).toBe(true);
  });
  it("concentrates a large fleet up to the existing faction vessel cap",()=>{
    const f=fixture();for(let i=0;i<48;i++)f.addShip(f.player.id,10+i%10);
    for(let i=0;i<20;i++)f.addShip(1,35+i%10);
    f.refresh();const mission=f.assess();expect(mission.members).toHaveLength(48);
    expect(f.game.shipAdmission.pendingCount).toBeGreaterThan(0);
  });

  it("uses sea dominance to raid loaded foreign trade outside capture contact",()=>{
    const f=fixture(),own=f.addShip();f.game.options.aiWarPolicy=true;f.addShip(f.player.id,12);
    const cargo={id:f.game.allocateId(),playerId:1,factoryId:f.port.id,originPortId:f.port.id,
      definitionId:"stoneage-trade",naval:true,x:35.5*FIXED,y:21.5*FIXED,cargo:20,loaded:20,delivered:0,lost:0,returned:0,
      valuePerGood:10,originTile:f.port.tile,capacity:20,shipmentId:1,stops:[],visited:[],destination:null,
      state:"outbound" as const,path:[],nextPathIndex:0,waitTicks:0,quoteAllies:[]};
    f.expansion.trade.actors.push(cargo);f.refresh();
    const apply=vi.spyOn(f.game,"applyCommand"),mission=f.assess();
    expect(mission.objective).toBe("raid-trade");
    expect(f.planner.allowsLocalPursuit(f.game.ship(own.id)!)).toBe(true);
    expect(apply.mock.calls.some(([c])=>c.type==="sail" && c.tile===f.game.tileOf(cargo))).toBe(true);
    expect(f.expansion.diplomacy.declaredWar(f.player.id,1)).toBe(true);
  });

  it("invests beyond two purchases, preserves the spending window, and caps repeated funding",()=>{
    const f=fixture();for(let i=0;i<8;i++)f.addShip(1,25+i);f.refresh();
    for(let i=0;i<4;i++){f.game.tick=i*100;f.assess();}
    expect(f.game.recruitment.jobs).toHaveLength(4);
    const spending=f.planner.checkpoint().funding[0][1];expect(spending.purchases).toBe(4);
    const gold=f.player.gold, saved=f.game.checkpoint();f.game.restore(saved);
    f.game.tick=500;f.assess();
    expect(f.game.recruitment.jobs).toHaveLength(4);expect(f.player.gold).toBe(gold);
    expect(f.planner.checkpoint().funding[0][1].windowSpent).toBe(spending.windowSpent);
  });
  it.each([["regular",32],["tribe",24]] as const)("respects the %s warship cap across disconnected seas before requesting funds",(kind,cap)=>{
    const f=fixture(true);
    f.player.kind=kind;
    for(let i=0;i<cap;i++)f.addShip(f.player.id,70+i%10);
    for(let i=0;i<8;i++)f.addShip(1,25+i);
    f.refresh();
    const apply=vi.spyOn(f.game,"applyCommand"),gold=f.player.gold;
    for(let i=0;i<4;i++){f.game.tick=i*100;f.assess();}
    expect(apply.mock.calls.some(([c])=>c.type==="recruit-ship")).toBe(false);
    expect(f.game.recruitment.jobs).toHaveLength(0);
    expect(f.player.gold).toBe(gold);
    expect(f.planner.checkpoint().funding).toHaveLength(0);
  });

  it("physically patrols while the mission retains movement ownership",()=>{
    const f=fixture(),ship=f.addShip();f.refresh();f.assess();
    const start={x:ship.x,y:ship.y};
    for(let i=0;i<120;i++){f.game.step();f.facts.step(f.game.tick,32);f.planner.step(16);}
    expect(Math.hypot(f.game.ship(ship.id)!.x-start.x,f.game.ship(ship.id)!.y-start.y)).toBeGreaterThan(FIXED);
    expect(f.planner.missions.get(f.player.id)?.members).toContain(ship.id);
  });
  it("selects an owned gathering port across seas instead of aborting in the first sea with unrelated facts", () => {
    const f = fixture(true);
    f.game.updateBuilding((f.game.building(f.port.id)!).id, { type: "factory" });
    const port = f.game.addBuilding({
      ...f.game.building(f.port.id)!,
      type: "port" as const,
      id: f.game.allocateId(),
      tile: f.map.ref(80, 19),
    });

    const west = f.addShip(f.player.id, 10),
      east = f.addShip(f.player.id, 80);
    f.refresh();
    const first = f.facts.firstSea(f.player.id),
      mission = f.assess(1);
    expect(mission.port).toBe(port.id);
    expect(mission.sea).not.toBe(first);
    expect(mission.members).toContain(east.id);
    expect(mission.members).not.toContain(west.id);
  });
  it("charges naval assessment and shared facts to the same bounded background allowance", () => {
    const f = fixture();
    for (let i = 0; i < 64; i++) {
      f.addShip(f.player.id, 10 + (i % 20));
      f.addShip(1, 25 + (i % 20));
    }
    f.refresh();
    f.game.options.runAi = true;
    f.game.tick = 200;
    const facts = vi.spyOn(f.facts, "step"),
      cities = vi.spyOn(f.expansion.economy.cities, "step"),
      naval = vi.spyOn(f.planner, "step");
    for (let i = 0; i < 8; i++) {
      f.expansion.economy.step();
      expect(
        f.expansion.economy.diagnostics.backgroundWork,
      ).toBeLessThanOrEqual(128);
      f.game.tick++;
    }
    expect(facts.mock.calls.every((c) => c[1] === 48)).toBe(true);
    expect(naval.mock.calls.every((c) => c[0] === 16)).toBe(true);
    expect(cities.mock.calls.every((c) => c[1]! >= 16)).toBe(true);
  });
  it("keeps a recovery slot and reattaches its repaired ship without replacing dock orders", () => {
    const f = fixture(),
      first = f.addShip(),
      second = f.addShip(f.player.id, 12);
    f.refresh();
    let mission = f.assess();
    const recovering = f.game.ship(first.id)!;
    f.game.updateShip(recovering.id, { health: 500 });
    f.game.updateShip(recovering.id, { repairState: "returning-to-dock" });
    f.game.updateShip(recovering.id, { repairPortId: mission.port });
    const before = structuredClone({
      state: recovering.repairState,
      port: recovering.repairPortId,
      destination: recovering.destination,
    });
    f.game.tick += 100;
    f.refresh();
    const apply = vi.spyOn(f.game, "applyCommand");
    mission = f.assess();
    expect(mission.members).toEqual([second.id]);
    expect(mission.recovering).toEqual([first.id]);
    expect(
      f.expansion.economy.assets.owns(`ship:${first.id}`, mission.id),
    ).toBe(true);
    expect({
      state: f.game.ship(first.id)!.repairState,
      port: f.game.ship(first.id)!.repairPortId,
      destination: f.game.ship(first.id)!.destination,
    }).toEqual(before);
    for (const [command] of apply.mock.calls)
      if (command.type === "sail")
        expect(command.shipIds).not.toContain(first.id);
    const saved = f.game.checkpoint(),
      clone = new Skirmish(f.map, f.game.options);
    clone.restore(saved);
    expect(clone.checkpoint()).toEqual(saved);
    const healed = f.game.ship(first.id)!;
    f.game.updateShip(healed.id, { health: 1000 });
    f.game.updateShip(healed.id, { repairState: "patrolling" });
    f.game.tick += 100;
    f.refresh();
    mission = f.assess();
    expect(mission.members).toContain(first.id);
    expect(mission.recovering).toEqual([]);
  });
  it("does not re-anchor a healthy mission merely because a newer port is closer to the base", () => {
    const f = fixture();
    f.addShip();
    f.refresh();
    const mission = f.assess(),
      anchor = mission.anchor;
    f.player.base = f.map.ref(80, 5);
    f.game.addBuilding({
      ...f.game.building(mission.port!)!,
      id: f.game.allocateId(),
      tile: f.map.ref(80, 19),
    });
    f.game.tick += 100;
    f.refresh();
    const current = f.assess();
    expect(current.port).toBe(f.port.id);
    expect(current.anchor).toBe(anchor);
  });
  it("keeps a legal same-sea target after it leaves the immediate port approach", () => {
    const f = fixture();
    f.addShip();
    f.addShip(f.player.id, 12);
    const enemy = f.addShip(1, 25);
    f.refresh();
    for (let i = 0; i < 100; i++) {
      f.planner.step(1);
      if (f.planner.missions.get(f.player.id)?.assessment?.phase === "jobs")
        break;
    }
    expect(f.planner.missions.get(f.player.id)!.assessment!.target).toBe(
      enemy.id,
    );
    f.game.updateShip(f.game.ship(enemy.id)!.id, { x: 90.5 * FIXED });
    const apply = vi.spyOn(f.game, "applyCommand"),
      mission = f.assess();
    expect(mission.state).toBe("execute");
    expect(apply.mock.calls.filter(([c]) => c.type === "sail")).toHaveLength(1);
  });
  it("retains spending evidence through restore and replenishes the allowance after expiry", () => {
    const f = fixture();
    f.addShip(1, 25);
    f.refresh();
    const gold = f.player.gold,
      first = f.assess();
    expect(first.purchases).toBe(1);
    f.game.tick += 100;
    f.assess();
    expect(first.purchases).toBe(2);
    for (const job of f.game.recruitment.jobs) f.game.recruitment.updateJob(job.id, {remainingTicks: 1});
    const complete = () => {
      f.addShip(f.player.id, 12, 0);
      return true;
    };
    f.game.recruitment.step(f.game.buildings, f.game.owners, complete, () => {
      throw Error("unexpected refund");
    });
    f.game.recruitment.step(f.game.buildings, f.game.owners, complete, () => {
      throw Error("unexpected refund");
    });
    expect(f.game.recruitment.jobs).toHaveLength(0);
    const spent = f.player.gold;
    expect(spent).toBeLessThan(gold);
    f.game.tick = first.deadline;
    f.planner.step();
    expect(first.state).toBe("abort");
    f.game.tick += 400;
    f.refresh();
    const saved = f.game.checkpoint(),
      clone = new Skirmish(f.map, f.game.options);
    clone.restore(saved);
    expect(clone.checkpoint()).toEqual(saved);
    const next = f.assess();
    expect(next.id).not.toBe(first.id);
    expect(next.purchases).toBe(1);
    expect(f.game.recruitment.jobs).toHaveLength(1);
    expect(f.player.gold).toBeLessThan(spent);
  });
  it("keeps cursors stable across ordinary ship movement and checkpoints", () => {
    const f = fixture();
    f.addShip();
    f.addShip(f.player.id, 20);
    f.refresh();
    const sea = f.facts.firstSea(f.player.id)!;
    const first = f.facts.readSea("ships", sea),
      cursor = first.next;
    const ship = f.game.ships[0];
    f.game.updateShip(ship.id, { x: 40.5 * FIXED });
    f.facts.observeShip(ship);
    expect(f.facts.readSea("ships", sea, cursor).invalid).toBe(false);
    const before = f.facts.checkpoint();
    f.facts.restore(before);
    expect(f.facts.readSea("ships", sea, cursor).id).toBe(f.game.ships[1].id);
    expect(f.facts.checkpoint()).toEqual(before);
  });
  it("pays a same-sea ship once and counts its training job instead of buying again", () => {
    const f = fixture();
    f.refresh();
    const definition = VESSEL.get("stoneage-warship")!;
    Object.assign(
      f.expansion.supply.inventories[f.player.id],
      definition.cost.items,
    );
    const gold = f.player.gold,
      mission = f.assess();
    expect(mission.state).toBe("assemble");
    expect(
      f.game.recruitment.jobs.filter((j) => j.category === "ship"),
    ).toHaveLength(1);
    expect(f.player.gold).toBe(gold - definition.cost.gold!);
    f.game.tick += 100;
    f.assess();
    expect(mission.purchases).toBe(1);
    expect(
      f.game.recruitment.jobs.filter((j) => j.category === "ship"),
    ).toHaveLength(1);
  });
  it("does not send isolated defenders into a stronger fleet or reset dock recovery", () => {
    const f = fixture(),
      own = f.addShip();
    const recovering = f.addShip(f.player.id, 12);
    f.game.updateShip(recovering.id, { repairState: "returning-to-dock" });
    for (let i = 0; i < 5; i++) f.addShip(1, 20 + i);
    f.refresh();
    const apply = vi.spyOn(f.game, "applyCommand"),
      mission = f.assess();
    expect(mission.state).not.toBe("execute");
    expect(mission.members).toContain(own.id);
    expect(mission.members).not.toContain(recovering.id);
    for (const [command] of apply.mock.calls)
      if (command.type === "sail") {
        expect(command.shipIds).not.toContain(recovering.id);
        expect(command.tile).toBe(mission.anchor);
      }
    expect(f.game.ship(recovering.id)?.repairState).toBe("returning-to-dock");
    expect(f.game.recruitment.jobs).toHaveLength(1);
  });
  it("intercepts as one concentrated selection and releases ownership when its port is captured", () => {
    const f = fixture();
    f.addShip();
    f.addShip(f.player.id, 12);
    f.addShip(1, 25);
    f.refresh();
    const apply = vi.spyOn(f.game, "applyCommand"),
      mission = f.assess();
    expect(mission.state).toBe("execute");
    const sails = apply.mock.calls
      .map(([command]) => command)
      .filter((c) => c.type === "sail");
    expect(sails).toHaveLength(1);
    expect(sails[0].shipIds).toHaveLength(2);
    expect(f.game.shipAdmission.pendingCount).toBe(1);
    f.game.updateBuilding((f.game.building(mission.port!)!).id, { playerId: 1 });
    f.planner.step();
    expect(mission.state).toBe("abort");
    expect(f.game.shipAdmission.pendingCount).toBe(0);
    expect(
      [...f.expansion.economy.assets.leases.values()].some(
        (l) => l.controller === mission.id,
      ),
    ).toBe(false);
  });
  it("resumes an in-progress assessment identically after a full checkpoint", () => {
    const f = fixture();
    f.addShip();
    f.addShip(1, 25);
    f.refresh();
    f.planner.step(1);
    const checkpoint = f.game.checkpoint();
    const clone = new Skirmish(f.map, f.game.options);
    clone.restore(checkpoint);
    for (let i = 0; i < 20; i++) {
      f.planner.step(1);
      clone.expansion!.economy.naval.step(1);
    }
    expect(clone.checkpoint()).toEqual(f.game.checkpoint());
    f.game.setAiController(f.player.id, false);
    expect(f.planner.missions.has(f.player.id)).toBe(false);
  });
  it("uses authored health and attack strength, with noncombat transports contributing no power", () => {
    const v = VESSEL.get("stoneage-warship")!;
    expect(navalPower(v, 500)).toBeLessThan(navalPower(v, 1000));
    expect(navalPower(VESSEL.get("stoneage-transport")!, 600)).toBe(0);
  });
  it("reports removal of the saved next cursor without pretending it reached the end", () => {
    const sequence = new NavalFactSequence();
    sequence.add(1);
    sequence.add(2);
    sequence.add(3);
    const cursor = sequence.read().next;
    sequence.remove(2);
    expect(sequence.read(cursor).invalid).toBe(true);
    expect(sequence.read(cursor).next).toBe(1);
  });
});
