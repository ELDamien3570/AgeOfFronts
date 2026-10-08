import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED } from "../../src/skirmish/Protocol";
import { BOMBER_ATTACK, STRATEGIC_PAYLOADS } from "../../src/skirmish/content/ModernWeapons";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";

function fixture() {
  const data=new Uint8Array(100*80).fill(133);
  for(let y=0;y<80;y++)for(let x=40;x<50;x++)data[y*100+x]=0;
  const game=new Skirmish(new GameMapImpl(100,80,data,data.length),
    {seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
  const victim=game.squads.find(s=>s.playerId===2)!;
  for (const squad of game.squads)
    if (squad.id!==victim.id) game.updateSquad(squad.id,{x:90.5*FIXED,y:70.5*FIXED});
  game.updateSquad(victim.id,{x:45.5*FIXED,y:40.5*FIXED,troops:1000,
    afloat:{hull:8000,maxHull:8000,vesselId:"modern-transport"}});
  const ship=game.addShip({id:game.allocateId(),kind:"warship",playerId:2,
    x:45.5*FIXED,y:40.5*FIXED,health:8000,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});
  const fire=(payload:"bomb"|"icbm"|"hydrogen"|"warhead")=>{
    const radius=payload==="bomb" ? BOMBER_ATTACK.projectile!.blastRadius :
      payload==="warhead" ? STRATEGIC_PAYLOADS.mirv.blastRadius : STRATEGIC_PAYLOADS[payload].blastRadius;
    const damage=payload==="bomb" ? BOMBER_ATTACK.damage : 24000;
    game.expansion!.battle.fire({id:999,playerId:1,x:45.5*FIXED,y:40.5*FIXED,domain:"aircraft"},
      {x:45.5*FIXED,y:40.5*FIXED},{...BOMBER_ATTACK,projectile:{...BOMBER_ATTACK.projectile!,blastRadius:radius}},
      damage,payload==="hydrogen" ? "icbm" : payload,1,0,payload);
    game.tick++;
    game.expansion!.battle.advanceProjectiles();
  };
  return {game,victim,ship,fire};
}

describe("air and strategic naval blast targets",()=>{
  it("damages every warship in a dense mixed-ownership stack without a shared blast budget or target cutoff",()=>{
    const {game,ship,fire}=fixture();
    const fleet=[ship,...Array.from({length:70},(_,index)=>game.addShip({
      ...ship,id:game.allocateId(),playerId:index%2+1,health:8000,
      waypoints:[],path:[],destination:null,
    }))];
    fire("bomb");
    for (const target of fleet) expect(game.ship(target.id)?.health).toBe(5900);
  });
  for (const ownership of ["own","allied"] as const)
    it.each(["bomb","icbm","hydrogen","warhead"] as const)(`damages ${ownership} transports, warships, ground squads and buildings with %s`,payload=>{
      const {game,victim,ship,fire}=fixture();
      const owner=ownership==="own" ? 1 : 2;
      if (ownership==="allied") {
        const diplomacy=game.expansion!.diplomacy;
        expect(diplomacy.action(game.players[0],game.players[1],"offer",0)).toBeNull();
        expect(diplomacy.action(game.players[1],game.players[0],"accept",0)).toBeNull();
      } else {
        game.updateSquad(victim.id,{playerId:owner});
        game.updateShip(ship.id,{playerId:owner});
      }
      const ground=game.squads.find(s=>s.id!==victim.id)!;
      game.updateSquad(ground.id,{playerId:owner,x:46.5*FIXED,y:40.5*FIXED,troops:1000});
      const building=game.addBuilding({id:game.allocateId(),playerId:owner,type:"factory",
        tile:game.map.ref(45,40),remainingTicks:0,age:"StoneAge",health:10000,maxHealth:10000});
      const wall=game.expansion!.fortifications.addBarrier({id:game.allocateId(),playerId:owner,
        age:"StoneAge",a:1,b:2,tiles:[game.map.ref(45,40)],health:10000,maxHealth:10000,remainingTicks:0});
      fire(payload);
      expect(game.squad(victim.id)?.afloat?.hull??0).toBeLessThan(8000);
      expect(game.ship(ship.id)?.health??0).toBeLessThan(8000);
      expect(game.squad(ground.id)?.troops??0).toBeLessThan(1000);
      expect(game.buildings.find(b=>b.id===building.id)?.health??0).toBeLessThan(10000);
      expect(wall.health).toBeLessThan(10000);
    });
  it("damages both transport hulls and warships with a bombing run",()=>{
    const {game,victim,ship,fire}=fixture();fire("bomb");
    expect(game.squad(victim.id)!.afloat!.hull).toBe(5900);
    expect(game.squad(victim.id)!.troops).toBe(1000);
    expect(game.ship(ship.id)!.health).toBe(5900);
  });
  it.each(["icbm","hydrogen","warhead"] as const)("sinks a full transport hull and warship with %s",payload=>{
    const {game,victim,ship,fire}=fixture();
    const losses=game.players[1].losses;
    fire(payload);
    expect(game.squad(victim.id)).toBeUndefined();
    expect(game.ship(ship.id)).toBeUndefined();
    expect(game.players[1].losses-losses).toBe(1000);
  });
  it.each(["bomb","icbm","hydrogen","warhead"] as const)("destroys friendly and enemy land/sea traders with %s, without duplicate cargo loss or payment",payload=>{
    const {game,fire}=fixture(),trade=game.expansion!.trade;
    const actor=(naval:boolean,owner=2,x=45.5):TradeActor=>{
      const source=game.addBuilding({id:game.allocateId(),playerId:owner,type:naval?"port":"factory",
        tile:game.map.ref(39,20+owner),remainingTicks:0,age:"StoneAge"});
      return {id:game.allocateId(),playerId:owner,factoryId:source.id,originTile:source.tile,
        definitionId:naval?"stoneage-trade":"stoneage-trader",naval,x:x*FIXED,y:40.5*FIXED,
        cargo:25,loaded:25,delivered:0,lost:0,returned:0,valuePerGood:20,capacity:25,
        shipmentId:1,stops:[],visited:[],visitedTiles:[],destination:null,state:"outbound",
        path:[],nextPathIndex:0,waitTicks:0,quoteAllies:[]};
    };
    const land=actor(false),sea=actor(true),friendly=actor(false,1),outside=actor(false,2,79.5);
    trade.actors.push(land,sea,friendly,outside);
    const gold=game.players.map(p=>p.gold);
    fire(payload);
    // Overlapping explosions must not record the destroyed cargo twice.
    trade.destroyInBlast(1,45.5*FIXED,40.5*FIXED,2*FIXED);
    const saved=game.checkpoint(),cold=new Skirmish(game.map,game.options);cold.restore(saved);
    trade.step();cold.expansion!.trade.step();
    expect(trade.actors.some(a=>a.id===land.id || a.id===sea.id)).toBe(false);
    expect(trade.actors.some(a=>a.id===friendly.id)).toBe(false);
    expect(trade.actors.some(a=>a.id===outside.id)).toBe(true);
    expect(trade.lostValue[2]).toBe(1000);
    expect(trade.lostValue[1]).toBe(500);
    expect(land.lost).toBe(25);expect(sea.lost).toBe(25);
    expect(game.players.map(p=>p.gold)).toEqual(gold);
    expect(cold.expansion!.trade.checkpoint()).toEqual(trade.checkpoint());
  });
});
