import {describe,it,expect} from 'vitest';
import {formationModifiers,shapeSpeedBp,tacticalFacts} from '../../src/skirmish/domain/FormationTactics';
import {formationForward,facingArc,armyFacingToFormation} from '../../src/skirmish/domain/FormationFacing';
import {createFormation,formationDoctrine,facingOf,TURN} from '../../src/skirmish/domain/FormationGeometry';
import {damageAmount,defenceOf,attackContributors} from '../../src/skirmish/domain/Combat';
import {resolveChargeImpact,commitChargeShot} from '../../src/skirmish/domain/ChargeImpact';
import {cohortDps,engagementEstimate,preferredShape} from '../../src/skirmish/domain/TacticalEstimate';
import {combatAdvantage,type Cohort} from '../../src/skirmish/domain/AiCombatPower';
import {validateMeleeStrike} from '../../src/skirmish/domain/MeleeStrike';
import {UNIT} from '../../src/skirmish/content/Units';
import type {Squad} from '../../src/skirmish/Protocol';
import {FIXED} from '../../src/skirmish/Protocol';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
import {createManpower} from '../../src/skirmish/domain/Manpower';
import {formationApproach} from '../../src/skirmish/domain/FormationContact';
const unit=UNIT.get('bronzeage-infantry')!;
type MutableSquad=Omit<Squad,"formation"> & {formation:ReturnType<typeof createFormation>};
function squad(id=1):MutableSquad{return {id,playerId:id,definitionId:unit.id,kind:'infantry',x:0,y:0,troops:24,xp:0,afloat:null,formation:{...createFormation(unit.id),shape:'line',facing:0}} as MutableSquad;}
describe('phase 7 tactical rules',()=>{
  it('uses the domain forward convention for sixteen headings',()=>{
    for(let i=0;i<16;i++){const a=i*Math.PI/8,s=squad();s.formation={...s.formation!,facing:armyFacingToFormation(a)};
      const f=formationForward(s,0);expect(f.x).toBeCloseTo(Math.cos(a),3);expect(f.y).toBeCloseTo(Math.sin(a),3);}
    const s=squad();expect(facingArc(s,{x:0,y:100},0)).toBe('front');expect(facingArc(s,{x:100,y:0},0)).toBe('flank');expect(facingArc(s,{x:0,y:-100},0)).toBe('rear');
    s.formation!.shape='square';expect(facingArc(s,{x:0,y:-100},0)).toBe('front');
  });
  it.each([['line','melee','flank',false,false,12500],['mass','melee','rear',false,false,12500],['shield-wall','ranged','front',false,false,6500],['shield-wall','melee','front',false,false,8500],['square','melee','rear',true,true,4000],['square','melee','flank',true,false,7500],['square','ranged','front',false,false,12500],['modern-loose','ranged','front',false,false,8000]] as const)('resolves %s %s %s', (shape,channel,arc,mounted,charge,bp)=>{
    const f=formationModifiers(shape,true,channel,arc,mounted,charge);expect(f.bp).toBe(bp);expect(f.modifiers.every(m=>m.length<=32)).toBe(true);
  });
  it('requires deployment for protection and movement penalties',()=>{
    expect(formationModifiers('shield-wall',false,'ranged','front',false).bp).toBe(10000);
    const s=squad();s.formation!.shape='square';expect(shapeSpeedBp(s,0)).toBe(3500);
    s.formation!.transition={from:'line',fromFacing:0,startTick:0,duration:10};expect(shapeSpeedBp(s,0)).toBe(10000);
  });
  it('clamps cover plus tactics after armour and bonus damage',()=>{
    const profile={...unit.meleeAttack!,damage:10,bonuses:{},penetration:10000};
    const defence={...defenceOf(unit),meleeArmour:0,cover:8000,tacticalBp:4000};
    expect(damageAmount(profile,defence,1)).toBe(2.5);expect(damageAmount(profile,{...defence,cover:0,tacticalBp:30000},1)).toBe(20);
  });
  it('keeps ranged ranks and magazines separate from charge commitments',()=>{
    const state={sharedReadyTick:100,ranged:{nextTick:120,remainder:3,shots:4},melee:{nextTick:110,remainder:0,shots:0}};
    const next=commitChargeShot(unit.meleeAttack!,state,50,10);expect(next.ranged).toEqual(state.ranged);expect(next.melee!.nextTick).toBeGreaterThan(50);expect(next.sharedReadyTick).toBeGreaterThanOrEqual(100);
    const s=squad(),p={...unit.meleeAttack!,channel:'ranged' as const};expect(attackContributors(s,p)).toBe(24);s.formation!.shape='mass';expect(attackContributors(s,p)).toBe(18);
  });
  it('shares one frontage budget between at most three targets deterministically',()=>{
    const s=squad();const targets=[5,2,4,3].map(id=>({...squad(id),x:(id-3)*30,y:300,formation:{...s.formation!,facing:TURN/2}}));
    const a=resolveChargeImpact(s,targets,unit.meleeAttack!,0,()=>defenceOf(unit));
    const b=resolveChargeImpact(s,[...targets].reverse(),unit.meleeAttack!,0,()=>defenceOf(unit));
    expect(a.hits.length).toBe(3);expect(a.budget).toBeGreaterThan(0);expect(a.total).toBeLessThanOrEqual(a.budget);expect(a).toEqual(b);
  });
  it('uses contact frontage in the shared AI resolver and quantizes advice',()=>{
    const a:Cohort={unit,strength:1,xp:0,contributors:12,health:240,shape:'line',deployed:true,count:1,width:6};
    const deeper={...a,health:480};expect(cohortDps([deeper],[a])).toBe(cohortDps([a],[a]));
    const e=engagementEstimate([deeper],[a]);expect(combatAdvantage([deeper],[a])).toBe(e.advantage);expect(e.advantage*1024).toBe(Math.round(e.advantage*1024));expect(e.secondsToBreak).toBeGreaterThan(0);
    expect(formationDoctrine(unit.id).shapes).toContain(preferredShape(unit,formationDoctrine(unit.id),{mountedShare:.8,rangedShare:.7,distanceTiles:5},'frontline'));
  });
  it('validates bounded, durable tactical explanation facts',()=>{
    const fact={tick:2,contacts:[{fromX:0,fromY:0,toX:0,toY:1,arc:'flank' as const,modifiers:['flank+25%'],damage:3,charge:true}]};expect(()=>validateMeleeStrike(fact,2)).not.toThrow();
    expect(()=>validateMeleeStrike({...fact,contacts:[{...fact.contacts[0],modifiers:['x'.repeat(33)]}]},2)).toThrow();
  });
  it('commits real battle explanations and preserves them through snapshot and checkpoint restore',()=>{
    const terrain=new Uint8Array(64*64).fill(133),map=new GameMapImpl(64,64,terrain,terrain.length);
    const options={seed:42,aiCount:1,runAi:false,tribes:false,ruleset:'ages-v1' as const};
    const game=new Skirmish(map,options),a=game.squads.find(s=>s.playerId===1)!,b=game.squads.find(s=>s.playerId===2)!;
    for(const s of [...game.squads])if(s.id!==a.id&&s.id!==b.id)game.removeSquad(s.id);
    for(const s of [a,b])game.updateSquad(s.id,{definitionId:unit.id,kind:unit.line,troops:unit.formationRecipe!.capacity,
      manpower:createManpower(unit),x:24*FIXED,y:(s.id===a.id?24:28)*FIXED,formation:{...createFormation(unit.id),facing:s.id===a.id?0:TURN/2},order:{type:'hold'}});
    game.updateSquad(b.id,formationApproach(game.squad(b.id)!,game.squad(a.id)!,0,unit.attack.range));
    game.expansion!.battle.fight([]);
    const fact=game.squad(a.id)!.combatFact!;expect(fact).toBeDefined();expect(fact.damage).toBeGreaterThan(0);expect(fact.targetId).toBe(b.id);
    const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()));expect(decoded.squads.find(s=>s.id===a.id)!.combatFact).toEqual(fact);
    const restored=new Skirmish(map,options);restored.restore(game.checkpoint());expect(restored.squad(a.id)!.combatFact).toEqual(fact);
    const bad=structuredClone(game.checkpoint());bad.squads=bad.squads.map(s=>s.id===a.id?{...s,combatFact:{...fact,modifiers:['x'.repeat(33)]}}:s);
    expect(()=>restored.restore(bad)).toThrow('Invalid combat explanation');
    expect(()=>restored.restore({...game.checkpoint(),version:7} as any)).toThrow();
  });
});
