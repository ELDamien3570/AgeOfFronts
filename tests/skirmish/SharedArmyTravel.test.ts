import {expect,it,vi} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {FIXED} from '../../src/skirmish/Protocol';

function fixture(){
  const cells=new Uint8Array(96*64).fill(133),g=new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',deferredPlanning:true,diplomacyRules:'raids-v1',armyTravel:'corridors-v1'});
  const own=g.squads.filter(s=>s.playerId===1);g.expansion!.progression.states[1].age='BronzeAge';g.expansion!.progression.states[1].completed=['rus-bronzeage-barracks-equipment'];
  expect(g.applyCommand({type:'create-army',playerId:1,squadIds:own.map(s=>s.id)})).toBeNull();
  for(const s of g.squads)g.updateSquad(s.id,{x:80*FIXED,y:50*FIXED,order:{type:'hold'}});
  g.updateSquad(own[0].id,{x:17.5*FIXED,y:30.5*FIXED});
  const route=Array.from({length:21},(_,i)=>({x:(15.5+i)*FIXED,y:30.5*FIXED}));
  const march={route,lengths:route.map((_,i)=>i*FIXED),cursor:10*FIXED,slots:new Map(),planned:new Map(),pending:new Set(),columnIds:own.map(s=>s.id),speed:0,started:0,phaseTick:0,retreating:false};
  return {g,own,march,armies:g.expansion!.armies,army:g.expansion!.armies.armies[0]};
}
it('follows a checked shared corridor without teleporting, and refuses a newly blocked corridor',()=>{
  const {g,own,march,armies,army}=fixture(),s=own[0],h=armies as any,goal={x:24.5*FIXED,y:s.y},before={x:s.x,y:s.y};
  expect(h.followCorridor(army,march,s,goal)).toBe(true);expect({x:s.x,y:s.y}).toEqual(before);
  expect(s.path).toContain(g.map.ref(20,30));expect(armies.travelWork.sharedLegs).toBe(1);
  g.expansion!.fortifications.addBarrier({id:g.allocateId(),a:1,b:2,playerId:2,age:'StoneAge',health:2000,maxHealth:2000,remainingTicks:0,tiles:[g.map.ref(20,30)]});
  const path=s.path;expect(h.followCorridor(army,march,s,goal)).toBe(false);expect(s.path).toBe(path);
});
it('admits only members needing reconnection instead of replanning ready members',()=>{
  const {g,own,march,armies,army}=fixture(),h=armies as any,selected=own.slice(0,2),slots=new Map(selected.map(s=>[s.id,{x:s.x+6*FIXED,y:s.y}]));
  vi.spyOn(h,'directMove').mockImplementation((_a,_m,s:any)=>s.id===selected[0].id);vi.spyOn(h,'followCorridor').mockReturnValue(false);
  const reconnect=vi.spyOn(h.cohorts,'start');expect(h.assign(army,march,selected,slots)).toBe(false);
  expect((reconnect.mock.calls[0][1] as typeof selected).map(s=>s.id)).toEqual([selected[1].id]);
  expect(armies.travelWork.recoveryMembers).toBe(1);expect(g.squad(selected[0].id)?.order.type).toBe('hold');
});
