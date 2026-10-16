import {describe,it,expect} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {UNIT} from '../../src/skirmish/content/Units';
import {createFormation,formationSlots,formationEnvelope} from '../../src/skirmish/domain/FormationGeometry';
import {createManpower,remainingHealth} from '../../src/skirmish/domain/Manpower';
import {formationApproach,formationContact,formationFootprint,formationSeparationLowerBound,rotationFootprint,contactParticipants} from '../../src/skirmish/domain/FormationContact';
import {LandingOccupancy} from '../../src/skirmish/LandingOccupancy';
import {FIXED} from '../../src/skirmish/Protocol';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
function encounter(){
 const terrain=new Uint8Array(64*64).fill(133),game=new Skirmish(new GameMapImpl(64,64,terrain,terrain.length),{seed:42,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
 const a=game.squads.find(s=>s.playerId===1)!,b=game.squads.find(s=>s.playerId===2)!,unit=UNIT.get('bronzeage-infantry')!;
 for(const s of [...game.squads])if(s.id!==a.id && s.id!==b.id)game.removeSquad(s.id);
 for(const s of [a,b])game.updateSquad(s.id,{definitionId:unit.id,kind:unit.line,troops:24,manpower:createManpower(unit),formation:{...createFormation(unit.id),shape:'shield-wall'},x:24*FIXED,y:(s===a?24:28)*FIXED,order:{type:'hold'},weaponState:{sharedReadyTick:s===a?0:10000}});
 game.updateSquad(b.id,formationApproach(b,a,0,0,Math.PI/2));
 const c=game.addSquad({...b,id:999,x:28*FIXED,y:a.y,formation:{...b.formation!}});
 game.updateSquad(c.id,formationApproach(c,a,0,0,0));
 game.tick=1;
 return{game,a,b,c,unit};
}
describe('formation repair contracts',()=>{
 it('retains committed front and flank presentation through event saturation, packet encoding and restore',()=>{
  const{game,a,b,c}=encounter();
  for(let i=0;i<4096;i++)game.volleys.push({id:game.allocateId(),tick:1,squadId:b.id,playerId:b.playerId,fromX:b.x,fromY:b.y,toX:a.x,toY:a.y});
  game.updateSquad(a.id,{order:{type:'attack',targetId:b.id}});game.expansion!.battle.fight([]);
  expect(game.volleys).toHaveLength(4096);
  expect(a.meleeStrike?.contacts.map(s=>s.targetId)).toEqual(expect.arrayContaining([b.id,c.id]));
  game.volleys.length=0; // Simulate transient effects unavailable at the received snapshot.
  const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
  const snapshot=decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
  expect(snapshot.squads.find(s=>s.id===a.id)!.meleeStrike).toEqual(a.meleeStrike);
  const saved=game.checkpoint(),restored=encounter().game;restored.restore(saved);
  expect(restored.squad(a.id)!.meleeStrike).toEqual(a.meleeStrike);
 });
 // Literals follow the current authored recipes (medieval 36/48 -> 40/50 and
 // Napoleonic cavalry 24/36 -> 48/64 in the HEAD retune).
 it('authors medieval 40/50, Napoleonic infantry 48/72 and Napoleonic cavalry 48/64',()=>{
  for(const id of ['earlymedieval-infantry','latemedieval-infantry'])expect(UNIT.get(id)!.formationRecipe).toMatchObject({capacity:40,enlargedCapacity:50,reserveCost:40});
  expect(UNIT.get('napoleonic-infantry')!.formationRecipe).toMatchObject({capacity:48,enlargedCapacity:72,reserveCost:48});
  expect(UNIT.get('napoleonic-cavalry')!.formationRecipe).toMatchObject({capacity:48,enlargedCapacity:64});
 });
 it('shares geometry while invalidating roots, facing, casualties and transition progress',()=>{
  const{a,b}=encounter();
  const body=formationFootprint(a,1),contact=formationContact(a,b,1);
  expect(formationFootprint(a,1)).toBe(body);expect(formationContact(a,b,1)).toBe(contact);
  expect(formationFootprint({...a,x:a.x+FIXED},1)).not.toEqual(body);
  expect(formationEnvelope({...a,troops:12},1).width).not.toBe(formationEnvelope(a,1).width);
  const turning={...a,formation:{...a.formation!,facing:16384,transition:{from:'mass' as const,fromFacing:0,startTick:0,duration:20}}};
  expect(formationFootprint(turning,1)).not.toEqual(formationFootprint(turning,10));
 });
 it('pairs reform slots by shortest travel instead of reversed array identity',()=>{
  const{a}=encounter(),to=formationSlots(a,1);
  const reform={...a,formation:{...a.formation!,transition:{from:a.formation!.shape,fromFacing:0,fromSlots:[...to].reverse(),startTick:1,duration:20}}};
  expect(formationSlots(reform,11)).toEqual(to);
 });
 it('retains physical contact facts across bookkeeping updates, with exact geometry invalidation',()=>{
  const{a,b}=encounter(),contact=formationContact(a,b,1),body=formationFootprint(a,1),sweep=rotationFootprint(a,1,1024);
  const bookkeeping={...a,formation:{...a.formation!,revision:a.formation!.revision+1,settledSince:1,blocked:false}};
  expect(formationFootprint(bookkeeping,2)).toBe(body);
  expect(formationContact(bookkeeping,b,2)).toBe(contact);
  expect(rotationFootprint(bookkeeping,2,1024)).toBe(sweep);
  expect(rotationFootprint({...bookkeeping,x:a.x+FIXED},2,1024)).not.toBe(sweep);
  expect(contactParticipants(bookkeeping,b,2,2,contact,true)).toBe(contactParticipants(a,b,1,2,contact,true));
  expect(formationContact({...bookkeeping,troops:12},b,2)).not.toBe(contact);
 });
 it('bounds nearest contact conservatively for rotated and separated formations',()=>{
  const{a,b}=encounter();
  for(const facing of [0,8192,16384,24576,32768])for(const distance of [0,1,4,12]){
   const target={...b,x:a.x+distance*FIXED,y:a.y+distance*FIXED/2,formation:{...b.formation!,facing}};
   expect(formationSeparationLowerBound(a,target,1)).toBeLessThanOrEqual(formationContact(a,target,1).gap**2+1e-6);
  }
 });
 it('applies a new attack priority on the next simulation tick without waiting for background work',()=>{
  const{game,a,b,c}=encounter();
  game.updateSquad(a.id,{order:{type:'attack',targetId:b.id},fighting:true,combatTargetId:b.id});
  expect(game.applyCommand({type:'order',playerId:1,squadIds:[a.id],order:{type:'attack',targetId:c.id}})).toBeNull();
  game.step();expect(a.combatTargetId).toBe(c.id);
 });
 it('keeps landing broad phase fresh after borrowed-record movement, boarding and removal',()=>{
  const{game,a,b}=encounter(),index=new LandingOccupancy(64,64,()=>1,[a,b]);
  expect(index.query(a).map(s=>s.id)).toContain(b.id);
  game.updateSquad(b.id,{x:50*FIXED});index.observe(b);expect(index.query(a).map(s=>s.id)).not.toContain(b.id);
  game.updateSquad(b.id,{x:a.x,y:a.y});index.observe(b);expect(index.query(a).map(s=>s.id)).toContain(b.id);
  game.updateSquad(b.id,{afloat:{hull:100,maxHull:100,vesselId:'cargo-canoe'}});index.observe(b);expect(index.query(a).map(s=>s.id)).not.toContain(b.id);
  game.updateSquad(b.id,{afloat:null});index.observe(b);index.remove(b.id);expect(index.query(a).map(s=>s.id)).not.toContain(b.id);
 });
 it('defends front and flank in one cycle and keeps its footprint when attack priority changes',()=>{
  const{game,a,b,c}=encounter(),before=remainingHealth(c);
  game.updateSquad(a.id,{order:{type:'attack',targetId:b.id}});
  game.expansion!.battle.fight([]);
  expect(game.volleys.filter(v=>v.squadId===a.id).map(v=>v.targetId)).toEqual(expect.arrayContaining([b.id,c.id]));
  expect(remainingHealth(c)).toBeLessThan(before);
  const facing=a.formation!.facing;
  expect(game.applyCommand({type:'order',playerId:1,squadIds:[a.id],order:{type:'attack',targetId:c.id}})).toBeNull();
  for(let i=0;i<10;i++){game.step();expect(a.formation!.facing).toBe(facing);}
  expect(a.combatTargetId).toBe(c.id);
 });
});
