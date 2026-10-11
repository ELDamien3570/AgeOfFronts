import {describe,it,expect,vi} from 'vitest';
import {TroopActors,type TroopActorDefinition} from '../../src/skirmish/client/troops/TroopActors';
import {TroopRemains} from '../../src/skirmish/client/troops/TroopRemains';
import {formationLoad} from './fixtures/FormationLoad';
import {FIXED} from '../../src/skirmish/Protocol';
import {FormationEngagement} from '../../src/skirmish/client/FormationEngagement';

describe('snapshot-driven offscreen casualty placement',()=>{
  it('preserves compressed front-edge history when beginFrame is followed by a skipped draw',()=>{
    const {game,squad,actors,internal,time}=fixture();
    const engaged=new FormationEngagement();
    const slots=[{id:0,x:0,y:0,scale:.2,front:true}],intent={active:true,charging:false,ranged:false,square:false,canonicalHeading:true,
      travelHeading:0,footprint:2.66,meleeReach:.1,contactAdvance:.5,target:{x:1,y:0}};
    engaged.sample(0,{x:0,y:0},slots,intent);
    const before=engaged.sample(100,{x:0,y:0},slots,intent);
    const history={engagement:engaged,motion:{soldiers:()=>[]}};
    internal.motions.set(squad.id,history);
    const details=actors as unknown as {completedDetail:Set<number>};details.completedDetail.add(squad.id);
    actors.beginFrame(); // Renderer can return false here without ever flushing.
    time(150);actors.prune(game.snapshot());
    expect(internal.motions.get(squad.id)).toBe(history);
    expect(engaged.sample(100,{x:0,y:0},slots,intent).slots[0].x).toBe(before.slots[0].x);
    expect(before.slots[0].x).toBeGreaterThan(0);
    expect(internal.remains.sample(150)).toHaveLength(0);
  });
  function fixture(){
    const {game}=formationLoad('crowded',15),squad=game.squads[0];
    const troop:TroopActorDefinition={name:'test',age:'test',mounted:false,ranged:false,memberScale:.2,members:12};
    let now=0;
    const actors=new TroopActors(()=>now,{troops:[troop],byDefinitionId:new Map([[squad.definitionId!,troop]])});
    const internal=actors as unknown as {remains:TroopRemains;motions:Map<number,unknown>;bodies:Map<number,unknown>};
    actors.prune(game.snapshot());
    return {game,squad,actors,internal,time:(n:number)=>now=n};
  }
  it('records losses at the current simulation position and never samples stale walkers',()=>{
    const {game,squad,actors,internal,time}=fixture(),stale=vi.fn(()=>({x:-100,y:-100}));
    internal.motions.set(squad.id,{walkers:{position:stale},motion:{soldiers:vi.fn(()=>[])}});
    game.updateSquad(squad.id,{x:squad.x+20*FIXED,y:squad.y+20*FIXED,troops:squad.troops-3});
    time(100);actors.prune(game.snapshot());
    const bodies=internal.remains.sample(100);
    expect(bodies).toHaveLength(3);expect(stale).not.toHaveBeenCalled();
    for(const body of bodies){expect(Math.abs(body.x-squad.x/FIXED)).toBeLessThan(6);expect(Math.abs(body.y-squad.y/FIXED)).toBeLessThan(6);}
    expect(internal.motions.has(squad.id)).toBe(false);
    actors.prune(game.snapshot());expect(internal.remains.sample(100)).toHaveLength(3);
  });
  it('records a destroyed offscreen squad at its latest snapshot position',()=>{
    const {game,squad,actors,internal,time}=fixture();
    game.updateSquad(squad.id,{x:squad.x+20*FIXED});time(50);actors.prune(game.snapshot());
    const x=squad.x/FIXED,count=squad.troops;
    const snapshot=game.snapshot();snapshot.squads=snapshot.squads.filter(s=>s.id!==squad.id);
    time(100);actors.prune(snapshot);
    const bodies=internal.remains.sample(100);expect(bodies).toHaveLength(count);
    for(const body of bodies)expect(Math.abs(body.x-x)).toBeLessThan(6);
  });
  it('tracks losses through icon-only detail and resets history with a new match',()=>{
    const {game,squad,actors,internal,time}=fixture();actors.setDetailed(false);
    game.updateSquad(squad.id,{troops:squad.troops-2});time(100);actors.prune(game.snapshot());
    expect(internal.remains.sample(100)).toHaveLength(2);
    actors.setDetailed(true);actors.prune(game.snapshot());expect(internal.remains.sample(100)).toHaveLength(2);
    actors.clear();actors.prune(game.snapshot());expect(internal.remains.sample(100)).toHaveLength(0);
  });
});
