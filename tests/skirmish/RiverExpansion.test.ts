import {describe,it,expect} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {HomeTerritory} from "../../src/skirmish/HomeTerritory";
import {RiverCrossings} from "../../src/skirmish/RiverCrossings";
import {Skirmish} from "../../src/skirmish/Simulation";
import {FIXED} from "../../src/skirmish/Protocol";

function fixture(connected=false) {
  const data=new Uint8Array(80*48).fill(133);
  for(let y=0;y<(connected?46:48);y++)for(let x=39;x<41;x++)data[y*80+x]=0;
  const map=new GameMapImpl(80,48,data,data.length),game=new Skirmish(map,{seed:42,aiCount:1,tribes:true,tribeCount:1,ruleset:"ages-v1",runAi:true,deferredPlanning:true});
  const tribe=game.players.find(p=>p.kind==="tribe")!;
  for(const b of [...game.buildings])game.removeBuilding(b.id);
  game.owners.fill(0);tribe.base=map.ref(34,24);tribe.reserves=100000;
  game.players[0].base=map.ref(5,5);
  game.players[1].base=map.ref(5,42);game.players[1].ai=false;
  for(let y=20;y<29;y++)for(let x=30;x<39;x++)game.owners[map.ref(x,y)]=tribe.id;
  game.owners[game.players[0].base]=1;
  game.owners[game.players[1].base]=2;
  for(const p of game.players)game.addBuilding({id:game.allocateId(),playerId:p.id,type:"city",tile:p.base,remainingTicks:0,health:1000});
  game.squads.filter(s=>s.playerId===tribe.id).forEach((s,i)=>game.updateSquad(s.id,{x:(35.5+i%2)*FIXED,y:(23.5+Math.floor(i/2))*FIXED,order:{type:"hold"},path:[],troops:1000}));
  for(const s of game.squads.filter(s=>s.playerId!==tribe.id))game.updateSquad(s.id,{x:5.5*FIXED,y:(s.playerId===1?5.5:42.5)*FIXED,order:{type:"hold"},path:[]});
  game.expansion!.progression.states[tribe.id].completed.push("stoneage-cargo-canoes");
  game.restore(game.checkpoint());
  return {game,map,tribe:game.players.find(p=>p.kind==="tribe")!};
}
describe("bounded frontier and river expansion",()=>{
  it("rotates beyond the first 128 cells and backs off failed goals through restore",()=>{
    const data=new Uint8Array(180*20).fill(133),map=new GameMapImpl(180,20,data,data.length),home=new HomeTerritory(map),owners=new Uint8Array(data.length),base=map.ref(1,1);
    owners[base]=2;home.frontier(2,base,owners,1);
    const frontier=Array.from({length:160},(_,i)=>map.ref(i+2,10)),reserved=new Set<number>();
    const first=home.goal(2,base,base,owners,frontier,reserved)!;
    home.failed(2,first,1);reserved.clear();
    const next=home.goal(2,base,base,owners,frontier,reserved)!;
    expect(next).not.toBe(first);
    const saved=home.checkpoint(),cold=new HomeTerritory(map);cold.restore(saved);
    expect(cold.goal(2,base,base,owners,frontier,new Set())).toBe(home.goal(2,base,base,owners,frontier,new Set()));
    expect(home.available(2,first,600)).toBe(false);expect(home.available(2,first,601)).toBe(true);
    const edge=home.goal(2,base,base,owners,frontier,new Set(),tile=>map.x(tile)>=130);
    expect(edge).toBeDefined();
  });
  it("indexes short crossings without treating open ocean as a river",()=>{
    const f=fixture(),index=new RiverCrossings(f.map,f.game.paths,f.game.waterPaths);
    expect(index.destinations(f.map.ref(38,24))).toContain(f.map.ref(41,24));
    expect(index.destinations(f.map.ref(30,24))).toEqual([]);
  });
  it("crosses with one small temporary transport and expands a disconnected bridgehead",()=>{
    const {game,map,tribe}=fixture();let maximum=0,restored:Skirmish|undefined;
    for(let tick=0;tick<2200;tick++) {
      game.step();maximum=Math.max(maximum,game.ships.filter(s=>s.playerId===tribe.id&&!!s.shoreTransfer).length);
      if(!restored&&game.ships.some(s=>s.playerId===tribe.id&&!!s.shoreTransfer)) {
        restored=new Skirmish(map,game.options);restored.restore(game.checkpoint());
        for(let i=0;i<30;i++){game.step();restored.step();}
        expect(restored.checkpoint()).toEqual(game.checkpoint());
      }
    }
    expect(restored).toBeDefined();expect(maximum).toBe(1);
    const captured=Array.from(game.owners).flatMap((owner,tile)=>owner===tribe.id&&map.x(tile)>=41?[tile]:[]);
    expect(captured.length).toBeGreaterThan(60);
    expect(captured.some(t=>map.x(t)>46)).toBe(true);
  });
  it("uses a short hop even when both banks connect by a distant land detour",()=>{
    const {game,map,tribe}=fixture(true);game.tick=56;
    expect(game.paths.connected(map.ref(38,24),map.ref(41,24))).toBe(true);
    let crossings=0;
    for(let tick=0;tick<800;tick++){game.step();crossings=Math.max(crossings,game.ships.filter(s=>s.playerId===tribe.id&&!!s.shoreTransfer).length);}
    expect(crossings).toBe(1);
    expect(game.squads.some(s=>s.playerId===tribe.id&&map.x(game.tileOf(s))>=41)).toBe(true);
    expect([...game.checkpoint().homeTerritory.bridgeheads.get(tribe.id)!.values()].some(t=>map.x(t)>=41&&game.owners[t]===tribe.id)).toBe(true);
  });
  it("sends a small reinforcement cohort to threatened owned land across a river",()=>{
    const {game,map,tribe}=fixture();
    for(let y=20;y<29;y++)for(let x=41;x<46;x++)game.owners[map.ref(x,y)]=tribe.id;
    const enemy=game.squads.find(s=>s.playerId===1)!;
    game.updateSquad(enemy.id,{x:43.5*FIXED,y:24.5*FIXED,troops:100});game.tick=56;
    let crossings=0;
    for(let tick=0;tick<900;tick++){game.step();crossings=Math.max(crossings,game.ships.filter(s=>s.playerId===tribe.id&&!!s.shoreTransfer).length);}
    expect(crossings).toBe(1);
    expect(game.squads.some(s=>s.playerId===tribe.id&&map.x(game.tileOf(s))>=41)).toBe(true);
  });
});
