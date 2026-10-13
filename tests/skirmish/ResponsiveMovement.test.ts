import { describe, expect, it } from 'vitest';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { LandPaths, AmphibiousPaths } from '../../src/skirmish/Pathfinding';
import { FIXED } from '../../src/skirmish/Protocol';
import { Skirmish } from '../../src/skirmish/Simulation';
import { standable, traversable } from '../../src/skirmish/SquadGeometry';
import { UNIT } from '../../src/skirmish/content/Units';
import { createFormation } from '../../src/skirmish/domain/FormationGeometry';
import { createManpower } from '../../src/skirmish/domain/Manpower';
import { TacticalFeatureIndex } from '../../src/skirmish/domain/TacticalFeatureIndex';
import { tacticalTerrain } from '../../src/skirmish/domain/TacticalTerrain';
import { retainSquads } from './UnitFixtures';
import { terrainSpeed } from '../../src/skirmish/Terrain';
import { PathTopology } from '../../src/skirmish/PathTopology';

function fixture(deferredPlanning=true, mountains=false) {
  const terrain=new Uint8Array(64*64).fill(133);
  if(mountains)for(let y=0;y<64;y++)for(let x=22;x<26;x++)terrain[y*64+x]=159;
  const map=new GameMapImpl(64,64,terrain,terrain.length);
  const game=new Skirmish(map,{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',deferredPlanning});
  const own=game.squads.find(s=>s.playerId===1)!,enemy=game.squads.find(s=>s.playerId===2)!;
  retainSquads(game,[own,enemy]);
  const unit=UNIT.get('bronzeage-infantry')!;
  for(const [s,x] of [[own,20.5],[enemy,26.5]] as const)game.updateSquad(s.id,{
    definitionId:unit.id,kind:unit.line,troops:unit.formationRecipe!.capacity,manpower:createManpower(unit),
    formation:createFormation(unit.id),x:x*FIXED,y:32.5*FIXED,order:{type:'hold'},path:[],queuedOrders:[],afloat:null});
  return {game,map,own,enemy};
}
describe('responsive movement gameplay',()=>{
  it.each([159,255])('gives legacy mountain byte %i a positive movement speed and route cost',byte=>{
    const map=new GameMapImpl(3,3,new Uint8Array(9).fill(byte),9);
    const topology=new PathTopology(map,'land');
    expect(map.isImpassable(4)).toBe(true);
    expect(topology.walkable(4)).toBe(true);
    expect(terrainSpeed(map,4)).toBe(20);
    expect(topology.cost(3,4)).toBe(28);
    expect(topology.cost(0,4)).toBe(40);
  });
  it.each([20.5,23.5])('marches across a mountain band from x=%s and continues identically after restore',startX=>{
    const {game,map,own,enemy}=fixture(true,true);
    game.updateSquad(enemy.id,{x:50.5*FIXED,y:50.5*FIXED});
    game.updateSquad(own.id,{x:startX*FIXED});
    expect(game.movementSpeed(own)).toBeGreaterThan(0);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[own.id],order:{type:'move',tile:map.ref(30,32)}})).toBeNull();
    for(let tick=0;tick<40;tick++)game.step();
    const restored=fixture(true,true).game;restored.restore(game.checkpoint());
    for(let tick=0;tick<400;tick++){game.step();restored.step();}
    expect(own.x).toBeGreaterThan(26*FIXED);
    expect(Math.hypot(own.x-30.5*FIXED,own.y-32.5*FIXED)).toBeLessThan(FIXED);
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });
  it('verifies old mountain-connectivity checkpoints before rebuilding their derived terrain index',()=>{
    const data=new Uint8Array(20*20).fill(133),component=new Int32Array(400);
    for(let tile=0;tile<400;tile++){const x=tile%20;component[tile]=x<10?1:x>10?2:0;if(x===10)data[tile]=255;}
    const map=new GameMapImpl(20,20,data,400),terrain=tacticalTerrain(map),legacy=new TacticalFeatureIndex(terrain,{
      component,walkable:t=>component[t]>0,connected:(a,b)=>component[a]>0&&component[a]===component[b]});
    legacy.step(20);
    const {navigationRulesVersion:_version,...saved}=legacy.checkpoint();
    const current=()=>new TacticalFeatureIndex(terrain,new LandPaths(map,false));
    const restored=current();restored.restore(saved);
    expect(restored.checkpoint().navigationRulesVersion).toBe(2);
    expect(restored.sourceHash).not.toBe(saved.sourceHash);
    expect(()=>current().restore({...saved,featureIndexHash:0})).toThrow(/hash/);
    expect(()=>current().restore({...saved,sourceHash:saved.sourceHash^1})).toThrow(/mismatch/);
    expect(()=>current().restore({...saved,navigationRulesVersion:2})).toThrow(/mismatch/);
  });
  it('routes across mountain scenery while retaining water separation',()=>{
    const terrain=new Uint8Array(20*20).fill(133);
    for(let y=0;y<20;y++)terrain[y*20+10]=255;
    const map=new GameMapImpl(20,20,terrain,400),land=new LandPaths(map,false);
    expect(map.isImpassable(map.ref(10,10))).toBe(true);
    expect(land.connected(map.ref(5,10),map.ref(15,10))).toBe(true);
    expect(land.find(map.ref(5,10),map.ref(15,10))).not.toBeNull();
    expect(standable(map,{x:10.5*FIXED,y:10.5*FIXED},100)).toBe(true);
    for(let y=0;y<20;y++)terrain[y*20+10]=0;
    const next=new GameMapImpl(20,20,terrain,380),paths=new LandPaths(next,false);
    expect(paths.connected(next.ref(5,10),next.ref(15,10))).toBe(false);
    const a={x:9.9*FIXED,y:10.5*FIXED},b={x:11.1*FIXED,y:10.5*FIXED};
    expect(standable(next,a,100)).toBe(true); // Body edges may overlap water.
    expect(traversable(next,a,b,100)).toBe(false);
    expect(traversable(next,a,b,100,true)).toBe(true);
    expect(new AmphibiousPaths(next,false).connected(next.ref(5,10),next.ref(15,10))).toBe(true);
  });
  it('finishes a reform overlapping mountains rather than pausing it',()=>{
    const {game,map,own,enemy}=fixture();game.updateSquad(enemy.id,{x:50*FIXED,y:50*FIXED});
    for(let y=28;y<37;y++)for(let x=17;x<25;x++)map.setMagnitude(map.ref(x,y),31);
    game.updateSquad(own.id,{formation:{...own.formation!,shape:'line',transition:{from:'mass',fromFacing:0,startTick:game.tick,duration:20}}});
    for(let i=0;i<25;i++)game.step();
    expect(own.formation?.transition).toBeUndefined();
    expect(own.formation?.blocked).not.toBe(true);
  });
  it.each([false,true])('accepts an enemy-occupied drawn line, deferred=%s',deferred=>{
    const {game,own,enemy}=fixture(deferred);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[own.id],order:{type:'move',tile:0},
      deploymentLine:{start:{x:enemy.x-2*FIXED,y:enemy.y},end:{x:enemy.x+2*FIXED,y:enemy.y}}})).toBeNull();
    expect(own.order.type).toBe('move');
  });
  it('turns a march into combat, releases its route, and preserves explicit queued orders across restore',()=>{
    const {game,map,own,enemy}=fixture(false);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[own.id],order:{type:'move',tile:map.ref(45,32)}})).toBeNull();
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[own.id],order:{type:'move',tile:map.ref(15,32)},append:true})).toBeNull();
    for(let i=0;i<200&&own.order.type==='move';i++)game.step();
    expect(own.order).toEqual({type:'attack',targetId:enemy.id});
    expect(own.path).toEqual([]);
    expect(own.queuedOrders).toHaveLength(1);
    const restored=new Skirmish(map,game.options);restored.restore(game.checkpoint());
    game.removeSquad(enemy.id);restored.removeSquad(enemy.id);game.step();restored.step();
    expect(own.order.type).toBe('move');
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });
  it('does not discard a march merely because a ranged squad can fire at a distant target',()=>{
    const {game,map,own,enemy}=fixture(false),unit=[...UNIT.values()].find(u=>u.line==='archer'&&u.age==='StoneAge'&&u.formationRecipe)!;
    game.updateSquad(own.id,{definitionId:unit.id,kind:unit.line,troops:unit.formationRecipe!.capacity,
      manpower:createManpower(unit),formation:createFormation(unit.id),fighting:true,combatTargetId:enemy.id});
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[own.id],order:{type:'move',tile:map.ref(40,32)}})).toBeNull();
    game.step();expect(own.order.type).toBe('move');
  });
});
