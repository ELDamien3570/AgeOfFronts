import {expect,it,vi} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {CombatGeometry} from '../../src/skirmish/domain/CombatGeometry';
import {CombatActivity} from '../../src/skirmish/domain/CombatActivity';
import {createFormation,formationEnvelope} from '../../src/skirmish/domain/FormationGeometry';
import {LandPaths,WaterPaths} from '../../src/skirmish/Pathfinding';
import {RoutePlanner} from '../../src/skirmish/RoutePlanner';
import {FIXED} from '../../src/skirmish/Protocol';

function game(){const cells=new Uint8Array(96*64).fill(133);return new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:3,tribes:false,runAi:false,ruleset:'ages-v1',diplomacyRules:'raids-v1',deferredPlanning:true});}
it('moving unrelated combatants cannot invalidate a pair-scoped acquisition region',()=>{
  const g=game(),geometry=new CombatGeometry(),activity=new CombatActivity(96,64),owners=new Set([1,2,3,4]);
  const own=g.squads.find(s=>s.playerId===1)!,enemy=g.squads.find(s=>s.playerId===2)!,other=g.squads.find(s=>s.playerId===3)!;
  for(const s of [own,enemy,other])g.updateSquad(s.id,{x:20.5*FIXED,y:20.5*FIXED});
  activity.update(g.squads,g.squadFacts(),geometry,0,owners);
  const before=activity.region(own,4*FIXED,1,[2]);g.updateSquad(other.id,{x:21*FIXED});activity.update(g.squads,g.squadFacts(),geometry,1,owners);
  expect(activity.region(own,4*FIXED,1,[2])).toBe(before);
  g.updateSquad(enemy.id,{x:21*FIXED});activity.update(g.squads,g.squadFacts(),geometry,2,owners);
  expect(activity.region(own,4*FIXED,1,[2])).toBeGreaterThan(before);
});
it('skips impossible acquisition, wakes immediately for war, and invalidates permissions when the opponent dies',()=>{
  const g=game(),battle=g.expansion!.battle,d=g.expansion!.diplomacy;
  battle.fight([]);expect(battle.acquisitionWork.searches).toBe(0);expect(battle.acquisitionWork.noOpponentSkips).toBeGreaterThan(0);
  d.establishWar(1,2,0);battle.fight([]);expect(battle.acquisitionWork.searches).toBeGreaterThan(0);
  const signature=d.permissionSignature(1);g.players[1].eliminated=true;d.step(1,g.players);
  expect(d.permissionSignature(1)).not.toBe(signature);battle.fight([]);expect(battle.acquisitionWork.searches).toBe(0);
});
it('reuses physical envelope computation across metadata replacement while preserving public revision',()=>{
  const g=game(),s=g.squads[0],geometry=new CombatGeometry();g.updateSquad(s.id,{formation:createFormation(s.definitionId!)});
  expect(geometry.envelope(s,0)).toEqual(formationEnvelope(s,0));
  g.updateSquad(s.id,{formation:{...s.formation!,revision:s.formation!.revision+1,blocked:true}});
  expect(geometry.envelope(s,1)).toEqual(formationEnvelope(s,1));expect(geometry.telemetry.envelopeBuilds).toBe(1);expect(geometry.telemetry.metadataReuses).toBe(1);
  g.updateSquad(s.id,{troops:s.troops-1});expect(geometry.envelope(s,2)).toEqual(formationEnvelope(s,2));expect(geometry.telemetry.envelopeBuilds).toBe(2);
  for(let revision=10;revision<30;revision++){
    const projected={...s,formation:{...s.formation!,revision}};
    expect(geometry.envelope(projected,3)).toEqual(formationEnvelope(projected,3));
  }
  expect(geometry.telemetry.envelopeBuilds).toBe(2);expect(geometry.telemetry.projectedReuses).toBe(20);
});
it('unrelated alliances do not invalidate another faction military or civilian routes',()=>{
  const g=game(),revision=(id:number,military=true)=>(g as any).routingObstacleRevision(id,military),before=revision(1),civilian=revision(1,false),affected=revision(3);
  expect(g.applyCommand({type:'alliance',playerId:3,otherId:4,action:'offer'})).toBeNull();
  expect(g.applyCommand({type:'alliance',playerId:4,otherId:3,action:'accept'})).toBeNull();
  expect(revision(1)).toBe(before);expect(revision(1,false)).toBe(civilian);expect(revision(3)).not.toBe(affected);
});
it('classification caching observes owner revision changes and restore without changing routing results',()=>{
  const cells=new Uint8Array(128*64).fill(133),map=new GameMapImpl(128,64,cells,cells.length),land=new LandPaths(map,false),water=new WaterPaths(map,false);
  let epoch=0,priorityValue=false,committedValue=false;
  const priority=vi.fn(()=>priorityValue),committed=vi.fn(()=>committedValue),identity=vi.fn(()=>({playerId:1,caller:'navigation' as const}));
  const planner=new RoutePlanner(land,water,{classificationRevision:()=>epoch,priority,committed,identity,valid:()=>true,obstacleRevision:()=> '0',blocked:()=>undefined,completed:()=>{}});
  planner.request({key:'long',start:map.ref(1,1),goal:map.ref(120,60),water:false,createdTick:0,obstacleRevision:'0',context:1});
  priority.mockClear();committed.mockClear();identity.mockClear();
  planner.step(1,64,4);expect(priority).toHaveBeenCalledTimes(1);expect(committed).toHaveBeenCalledTimes(1);expect(identity).toHaveBeenCalledTimes(1);
  planner.step(2,64,4);expect(priority).toHaveBeenCalledTimes(1);
  epoch++;priorityValue=true;committedValue=true;planner.step(3,64,4);expect(priority).toHaveBeenCalledTimes(2);
  const saved=planner.checkpoint();planner.restore(saved);planner.step(4,64,4);expect(priority).toHaveBeenCalledTimes(3);
});
