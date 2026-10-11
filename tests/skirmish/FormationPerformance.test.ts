import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { formationLoad } from './fixtures/FormationLoad';
import { DamageLedger } from '../../src/skirmish/Conquest';
import { UnitIndex } from '../../src/skirmish/UnitIndex';
import { FIXED } from '../../src/skirmish/Protocol';
import { formationFootprints, polygonsOverlap, formationContact, PreparedFormationBody } from '../../src/skirmish/domain/FormationContact';
import { CombatActivity } from '../../src/skirmish/domain/CombatActivity';
import { CombatGeometry } from '../../src/skirmish/domain/CombatGeometry';

describe('formation performance contracts', () => {
  it('prepares exact immutable bodies and refreshes borrowed poses on motion and clock changes',()=>{
    const {game}=formationLoad('crowded',60),a=game.squads[0],b=game.squads[50],geometry=new CombatGeometry();
    const preparedA=new PreparedFormationBody(a,0),preparedB=new PreparedFormationBody(b,0),before=formationContact(a,b,0);
    expect(preparedA.contact(preparedB)).toBe(before);expect(geometry.contact(a,b,0)).toBe(before);
    game.updateSquad(b.id,{x:b.x+3*FIXED});
    expect(preparedA.contact(preparedB)).toBe(before);
    expect(geometry.contact(a,b,0)).toEqual(formationContact(a,b,0));
    expect(geometry.contact(a,b,1)).toEqual(formationContact(a,b,1));
    game.updateSquad(b.id,{formation:{...b.formation!,facing:16384,transition:{from:'line',fromFacing:0,startTick:1,duration:20}}});
    expect(geometry.contact(a,b,2)).toEqual(formationContact(a,b,2));
    expect(geometry.contact(a,b,12)).toEqual(formationContact(a,b,12));
  });
  it('wakes local searches for arrivals, casualties and removals without waking distant battles',()=>{
    const {game}=formationLoad('distributed',15),a=game.squads[0],b=game.squads[14],geometry=new CombatGeometry();
    const activity=new CombatActivity(500,250);activity.update(game.squads,game.squadFacts(),geometry,0);
    const initial=activity.region(a,4*FIXED);
    game.updateSquad(b.id,{x:b.x+FIXED});activity.update(game.squads,game.squadFacts(),geometry,0);
    expect(activity.region(a,4*FIXED)).toBe(initial);
    game.updateSquad(b.id,{x:a.x+4*FIXED,y:a.y});activity.update(game.squads,game.squadFacts(),geometry,0);
    const arrived=activity.region(a,4*FIXED);expect(arrived).toBeGreaterThan(initial);
    game.updateSquad(b.id,{troops:b.troops-1});activity.update(game.squads,game.squadFacts(),geometry,0);
    const injured=activity.region(a,4*FIXED);expect(injured).toBeGreaterThan(arrived);
    game.removeSquad(b.id);activity.update(game.squads,game.squadFacts(),geometry,0);
    expect(activity.region(a,4*FIXED)).toBeGreaterThan(injured);
  });
  it('matches fresh searches through repeated orders, movement and restored combat',()=>{
    const cached=formationLoad('crowded',60).game,reference=formationLoad('crowded',60).game;
    Object.defineProperty(reference,'spatialFacts',{value:undefined});
    for(let tick=0;tick<100;tick++){
      for(const game of [cached,reference]){
        const source=game.squads[0],target=game.squads[(tick%2)+1];
        if(tick%20===0)game.applyCommand({type:'order',playerId:source.playerId,squadIds:[source.id],order:{type:'attack',targetId:target.id}});
        if(tick===35)game.updateSquad(target.id,{x:target.x+FIXED});
        if(tick===60)game.restore(game.checkpoint());
        game.step();
      }
      if(tick%20===0 || tick===99){
        const digest=(game:typeof cached)=>createHash('sha256').update(JSON.stringify(game.checkpoint(),(_key,value)=>
          value instanceof Map?[...value]:value instanceof Set?[...value]:ArrayBuffer.isView(value)?Array.from(value as Uint8Array):value)).digest('hex');
        expect(digest(cached)).toBe(digest(reference));
      }
    }
  },15000);
  it('creates 2000 legal squads within faction limits and with populated combat', () => {
    const {game} = formationLoad('crowded');
    expect(game.squads).toHaveLength(2000);
    for (const p of game.players) expect(game.squads.filter(s=>s.playerId===p.id).length).toBeLessThanOrEqual(200);
    // Adjacent fronts are close but start without overlapping physical bodies.
    const a=game.squads[0],b=game.squads[50];
    expect(formationFootprints(a,0).some(x=>formationFootprints(b,0).some(y=>polygonsOverlap(x,y)))).toBe(false);
    game.step();
    expect(game.squads.filter(s=>s.fighting).length).toBeGreaterThan(1900);
  });
  it('does not reuse targets after diplomacy changes or an explicit retarget',()=>{
    const {game}=formationLoad('crowded',60);
    for(let i=0;i<6;i++)game.step();
    const source=game.squads.find(s=>s.combatTargetId!==null)!;
    const target=game.squad(source.combatTargetId!)!;
    game.expansion!.diplomacy.state.alliances.push({id:999,a:source.playerId,b:target.playerId,expiresTick:10000,renewal:[]});
    game.expansion!.diplomacy.revision++;
    game.step();expect(source.combatTargetId).not.toBe(target.id);
    const other=game.squads.find(s=>game.hostile(source.playerId,s.playerId))!;
    expect(game.applyCommand({type:'order',playerId:source.playerId,squadIds:[source.id],order:{type:'attack',targetId:other.id}})).toBeNull();
    game.step();expect(source.order).toMatchObject({type:'attack',targetId:other.id});
  });
  it('retains a legal automatic ranged target and honors an explicit in-range target immediately',()=>{
    const {game}=formationLoad('crowded',60),source=game.squads[0],held=game.squads[50],closer=game.squads[51];
    for(const s of [...game.squads])if(![source.id,held.id,closer.id].includes(s.id))game.removeSquad(s.id);
    game.updateSquad(held.id,{x:source.x,y:source.y+3*FIXED});
    game.updateSquad(closer.id,{x:source.x,y:source.y+2.8*FIXED});
    game.updateSquad(source.id,{fighting:true,combatTargetId:held.id});
    game.step();expect(source.combatTargetId).toBe(held.id);
    expect(game.applyCommand({type:'order',playerId:source.playerId,squadIds:[source.id],order:{type:'attack',targetId:closer.id}})).toBeNull();
    game.step();expect(source.combatTargetId).toBe(closer.id);
    game.removeSquad(closer.id);game.step();expect(source.combatTargetId).toBe(held.id);
  });
  it('keeps spatial facts through administrative edits and invalidates physical edits immediately', () => {
    const {game}=formationLoad('distributed',15),s=game.squads[0],index=new UnitIndex<typeof s>();
    index.add(s);const revision=index.spatialRevision;
    game.updateSquad(s.id,{formation:{...s.formation!,revision:s.formation!.revision+1,settledSince:1}});
    index.changed(s);expect(index.spatialRevision).toBe(revision);
    game.updateSquad(s.id,{formation:{...s.formation!,facing:8192}});
    index.changed(s);expect(index.spatialRevision).toBe(revision+1);
    game.updateSquad(s.id,{x:s.x+FIXED});index.changed(s);
    expect(index.spatialRevision).toBe(revision+2);
    game.updateSquad(s.id,{troops:s.troops-1});index.changed(s);
    expect(index.spatialRevision).toBe(revision+3);
    game.updateSquad(s.id,{afloat:{hull:100,maxHull:100,vesselId:'cargo-canoe'}});index.changed(s);
    expect(index.spatialRevision).toBe(revision+4);
    game.updateSquad(s.id,{afloat:null});index.changed(s);expect(index.spatialRevision).toBe(revision+5);
  });
  it('does not dirty an unchanged contested capture tile on every tick',()=>{
    const {game}=formationLoad('distributed',15),[a,b]=game.squads;
    for(const s of [...game.squads])if(s.id!==a.id && s.id!==b.id)game.removeSquad(s.id);
    for(const s of [a,b])game.updateSquad(s.id,{x:50.5*FIXED,y:50.5*FIXED,weaponState:{sharedReadyTick:10000}});
    game.step();const cursor=game.tileChanges.revision,tile=50*500+50;
    expect(game.claims[tile]).toBe(0);expect(game.progress[tile]).toBe(0);
    game.step();expect(game.tileChanges.since(cursor)).not.toContain(tile);
  });
  it('attributes only current impacts, preserves event proportions and rebuilds between ledger passes', () => {
    const {game}=formationLoad('distributed',15),[source,target]=game.squads;
    const event=(damage:number,tick=0,impact=true)=>({id:game.allocateId(),tick,squadId:source.id,
      playerId:source.playerId,targetId:target.id,fromX:source.x,fromY:source.y,toX:target.x,toY:target.y,damage,impact});
    const a=event(1),b=event(3),old=event(99,-1),flight=event(99,0,false);
    game.volleys.push(a,b,old,flight);
    const ledger=new DamageLedger();ledger.add(target.id,source.playerId,2);
    const contributions=new Map([[target.id,[{id:`squad:${source.id}`,damage:2}]]]);
    game.expansion!.battle.awardDamage(ledger,contributions);
    expect([a.damage,b.damage,old.damage,flight.damage]).toEqual([.5,1.5,99,99]);
    const added=event(2);game.volleys.push(added);
    game.expansion!.battle.awardDamage(ledger,contributions);
    expect([a.damage,b.damage,added.damage]).toEqual([.25,.75,1]);
  });
});
