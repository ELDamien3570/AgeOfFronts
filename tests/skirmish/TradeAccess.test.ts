import {describe,expect,it,vi} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {FIXED} from "../../src/skirmish/Protocol";
import {Skirmish} from "../../src/skirmish/Simulation";
import {SnapshotEncoder,SnapshotDecoder} from "../../src/skirmish/SnapshotCodec";
import type {TradeActor} from "../../src/skirmish/domain/Definitions";

function fixture(){
  const map=new GameMapImpl(180,64,new Uint8Array(180*64).fill(133),180*64);
  const game=new Skirmish(map,{seed:47,aiCount:2,tribes:false,runAi:false,ruleset:"ages-v1",aiWarPolicy:true});
  for(const b of [...game.buildings])game.removeBuilding(b.id);
  const territory=game.checkpoint();territory.owners.fill(0);
  for(let y=0;y<64;y++)for(let x=0;x<180;x++){
    if(x<15)territory.owners[map.ref(x,y)]=1;
    if(x>=145)territory.owners[map.ref(x,y)]=2;
  }
  game.restore(territory);
  const expansion=game.expansion!,trade=expansion.trade;
  const add=(type:"factory"|"city",x:number,owner:number)=>game.addBuilding({id:game.allocateId(),type,
    tile:map.ref(x,32),playerId:owner,age:"StoneAge",remainingTicks:0});
  const source=add("factory",8,1),market=add("city",150,2);
  expansion.progression.states[1].completed.push("stoneage-goods-handling");
  expansion.supply.goods.set(source.id,25);
  for(const s of game.squads)game.updateSquad(s.id,{x:s.playerId*30*FIXED,y:5*FIXED,order:{type:"hold"}});
  const step=(n=1)=>{for(let i=0;i<n;i++){game.tick++;trade.step();}};
  return {game,map,expansion,trade,source,market,step};
}
describe("overland trade access and bilateral relations",()=>{
  it("delivers to a distant nonadjacent neutral nation across unclaimed land",()=>{
    const f=fixture(),adjacency=vi.spyOn(f.game,"factionAdjacent").mockReturnValue(false);
    f.step(22);const a=f.trade.actors[0];
    expect(a.cargo).toBe(25);expect(a.destination).toBe(f.market.id);
    expect(a.path.some(t=>f.game.owners[t]===0)).toBe(true);
    expect(f.trade.checkpoint().routeLengths.length).toBeGreaterThan(0);
    for(let i=0;i<4000 && !a.returned;i++)f.step();
    expect(a.delivered).toBe(15);expect(a.returned).toBe(10);
    expect(f.trade.deliveredGold[1]).toBe(600);
    expect(a.loaded).toBe(a.cargo+a.delivered+a.returned+a.lost);
    expect(adjacency).not.toHaveBeenCalled();
  });
  it("shares bounded market discovery and eventually considers distant markets",()=>{
    const f=fixture();
    for(let i=0;i<70;i++)f.game.addBuilding({...f.market,id:f.game.allocateId(),tile:f.map.ref(60+i,32)});
    f.step(22);
    f.expansion.supply.goods.set(f.source.id,25);
    const query=f.trade as unknown as {landCandidates(a:TradeActor):typeof f.game.buildings;candidates(a:TradeActor):typeof f.game.buildings};
    const a={...f.trade.actors[0],state:"loading" as const,cargo:0,visited:[],visitedTiles:[]};
    const reads=f.trade.diagnostics.marketReads;
    for(let i=0;i<100;i++)expect(query.landCandidates(a).length).toBeLessThanOrEqual(32);
    expect(f.trade.diagnostics.marketReads).toBe(reads);
    const seen=new Set<number>();
    for(let epoch=0;epoch<20;epoch++){
      f.game.tick=epoch*200+22;
      if(query.landCandidates(a).some(b=>b.id===f.market.id))seen.add(f.market.id);
    }
    expect(seen.has(f.market.id)).toBe(true);
  });
  it("crosses a neutral nation that admits its trade, but not one that refuses it",()=>{
    const open=fixture();for(let y=0;y<64;y++)open.game.owners[open.map.ref(80,y)]=3;
    open.step(22);const a=open.trade.actors[0];
    expect(a.path.some(t=>open.game.owners[t]===3)).toBe(true);
    for(let i=0;i<4000 && !a.delivered;i++)open.step();
    expect(a.delivered).toBeGreaterThan(0);
    const closed=fixture();for(let y=0;y<64;y++)closed.game.owners[closed.map.ref(80,y)]=3;
    closed.trade.setBlocked(3,1,true,false);
    closed.step(500);
    expect(closed.trade.actors.every(a=>a.loaded===0)).toBe(true);
    expect(closed.expansion.supply.goods.get(closed.source.id)).toBe(25);
    expect(closed.trade.deliveredGold[1]??0).toBe(0);
  });
  it("walks out of a market's land when its owner declares war, never back into it",()=>{
    const f=fixture();
    f.step(22);const a=f.trade.actors[0];
    for(let i=0;i<4000 && !a.delivered;i++)f.step();
    expect(f.game.owners[f.game.tileOf(a)]).toBe(2);
    expect(f.expansion.diplomacy.action(f.game.players[1],f.game.players[0],"declare",f.game.tick)).toBeNull();
    for(let i=0;i<6000 && a.state!=="loading";i++){
      f.step();
      // Once outside the enemy's land the courier never re-enters it.
      if(f.map.x(f.game.tileOf(a))<145)expect(a.path.slice(a.nextPathIndex).every(t=>f.game.owners[t]!==2)).toBe(true);
    }
    expect(a.state).toBe("loading");
    expect(f.trade.actors.every(c=>c.destination===null || f.game.building(c.destination)?.playerId!==2)).toBe(true);
  });
  it("brings a courier home across a neutral border that closed behind it",()=>{
    const f=fixture();
    f.step(22);const a=f.trade.actors[0];
    for(let i=0;i<4000 && !a.delivered;i++)f.step();
    expect(a.delivered).toBeGreaterThan(0);
    // An unrelated nation now spans the whole route home. Outbound trade would
    // refuse this transit; an empty courier heading home must not be stranded.
    for(let y=0;y<64;y++)f.game.owners[f.map.ref(80,y)]=3;
    for(let i=0;i<6000 && a.state!=="loading";i++)f.step();
    expect(a.state).toBe("loading");
    expect(f.map.x(f.trade.actors[0].originTile)).toBe(8);
  });
  it("allows allied transit then stops at a newly hostile transit border without losing cargo",()=>{
    const f=fixture();for(let y=0;y<64;y++)f.game.owners[f.map.ref(80,y)]=3;
    const dip=f.expansion.diplomacy;
    expect(dip.action(f.game.players[0],f.game.players[2],"offer",0)).toBeNull();
    expect(dip.action(f.game.players[2],f.game.players[0],"accept",0)).toBeNull();
    f.step(22);const a=f.trade.actors[0];expect(a.cargo).toBe(25);
    a.waitTicks=0;a.nextPathIndex=a.path.findIndex(t=>f.game.owners[t]===3);
    expect(a.nextPathIndex).toBeGreaterThan(0);
    expect(dip.action(f.game.players[2],f.game.players[0],"declare",f.game.tick)).toBeNull();
    f.step();expect(a.path).toEqual([]);expect(a.cargo).toBe(25);
    expect(f.trade.deliveredGold[1]??0).toBe(0);
  });
  it("shares retaliation, formal war, and alliances between borders and trade, preserving expiry through restore",()=>{
    const f=fixture(),encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
    const publish=()=>decoder.decode(encoder.encode(f.game.snapshot(),undefined,f.game.replicationFacts()));
    expect(publish().expansion!.pairRelations).toEqual([]);
    f.game.notifyHostileAction(2,1,f.market.tile);
    expect(f.trade.atWar(1,2)).toBe(true);
    expect(publish().expansion!.pairRelations).toEqual([{a:1,b:2,state:"conflict"}]);
    const saved=f.game.checkpoint(),cold=new Skirmish(f.map,f.game.options);cold.restore(saved);
    expect(cold.checkpoint()).toEqual(saved);
    f.game.tick=cold.tick=601;
    expect(f.trade.atWar(1,2)).toBe(false);expect(cold.expansion!.trade.atWar(1,2)).toBe(false);
    expect(publish().expansion!.pairRelations).toEqual([]);
    const dip=f.expansion.diplomacy;
    expect(dip.action(f.game.players[0],f.game.players[1],"declare",601)).toBeNull();
    expect(publish().expansion!.pairRelations).toEqual([{a:1,b:2,state:"war"}]);
    f.game.notifyHostileAction(2,1,f.market.tile);
    expect(publish().expansion!.pairRelations).toEqual([{a:1,b:2,state:"conflict"}]);
    expect(dip.action(f.game.players[0],f.game.players[1],"offer",601)).toBeNull();
    expect(dip.action(f.game.players[1],f.game.players[0],"accept",601)).toBeNull();
    expect(f.trade.atWar(1,2)).toBe(false);
    expect(publish().expansion!.pairRelations).toEqual([{a:1,b:2,state:"allied"}]);
  });
});
