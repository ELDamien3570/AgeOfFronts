import { describe, expect, it } from 'vitest';
import { Skirmish } from '../../src/skirmish/Simulation';
import { SnapshotDecoder, SnapshotEncoder } from '../../src/skirmish/SnapshotCodec';
import { FIXED } from '../../src/skirmish/Protocol';
import { highGroundDamageModifier } from '../../src/skirmish/domain/ElevationAdvantage';
import { validateCombatFact, validCombatModifiers } from '../../src/skirmish/domain/CombatFact';
import { hillDefenceScene } from './fixtures/HillDefence';
import { UNITS } from '../../src/skirmish/content/Units';
import { createManpower } from '../../src/skirmish/domain/Manpower';
import { createFormation } from '../../src/skirmish/domain/FormationGeometry';

function checkTransport(game:Skirmish, sourceId:number) {
  const fact=game.squad(sourceId)!.combatFact!;
  expect(fact).toBeDefined();
  expect(fact.modifiers).toContain('high ground +10% base damage');
  expect(()=>validateCombatFact(fact,game.tick)).not.toThrow();
  const decoder=new SnapshotDecoder(), encoder=new SnapshotEncoder();
  expect(decoder.decode(encoder.encode(game.snapshot())).squads.find(s=>s.id===sourceId)!.combatFact).toEqual(fact);
  game.tick++;
  expect(decoder.decode(encoder.encode(game.snapshot())).squads.find(s=>s.id===sourceId)!.combatFact).toEqual(fact);
  const copy=new Skirmish(game.map,{...game.options});
  copy.restore(game.checkpoint());
  expect(copy.squad(sourceId)!.combatFact).toEqual(fact);
}

describe('stalled match state contracts',()=>{
  it('keeps every legal elevation explanation within the shared combat bounds',()=>{
    for(let bp=10000;bp<=11000;bp++) expect(validCombatModifiers([highGroundDamageModifier(bp)])).toBe(true);
    expect(validCombatModifiers(['x'.repeat(33)])).toBe(false);
    expect(validCombatModifiers(Array(7).fill('cover'))).toBe(false);
  });
  it('replicates and restores real downhill volley explanations',()=>{
    const {game,defenders,riders}=hillDefenceScene(true),source=defenders[0],target=riders[0];
    const unit=UNITS.find(u=>u.age==='Napoleonic'&&u.attack.perSoldier&&u.attack.channel==='ranged'&&!u.attack.projectile)!;
    game.updateSquad(target.id,{x:32*FIXED,y:36*FIXED});
    game.updateSquad(source.id,{definitionId:unit.id,kind:unit.line,troops:unit.formationRecipe!.capacity,
      manpower:createManpower(unit),formation:createFormation(unit.id),order:{type:'attack',targetId:target.id}});
    game.expansion!.battle.fight([]);
    checkTransport(game,source.id);
  });
  it('replicates and restores downhill projectile impact explanations',()=>{
    const {game,defenders,riders}=hillDefenceScene(true),source=defenders[0],target=riders[0],battle=game.expansion!.battle;
    game.updateSquad(target.id,{x:32*FIXED,y:40*FIXED});
    const profile=game.expansion!.unit(source).attack;
    expect(battle.fire(source,target,profile,profile.damage,'shell',10)).toBe(true);
    const impact=battle.projectiles[0].impactTick;
    while(game.tick<=impact){game.tick++;battle.advanceProjectiles();}
    checkTransport(game,source.id);
  });
  it('resets roster continuations after casualties and remains restorable through recovery',()=>{
    const {game,defenders}=hillDefenceScene(),planner=game.expansion!.economy.military.armyPlanner;
    const plan=planner.missions.get('hill-review')!;
    plan.phase='rally';plan.cursor=plan.rosterIds.length;plan.resizeCursor=plan.rosterIds.length;
    game.removeSquad(defenders[2].id);game.removeSquad(defenders[3].id);
    planner.step();
    expect(plan.rosterIds).toHaveLength(2);
    expect(plan.cursor).toBe(0);expect(plan.resizeCursor).toBe(0);
    plan.phase='recover';
    const copy=new Skirmish(game.map,{...game.options});
    copy.restore(game.checkpoint());
    expect(copy.expansion!.economy.military.armyPlanner.checkpoint()).toEqual(planner.checkpoint());
    const bad=planner.checkpoint();
    bad.missions[0][1].cursor=bad.missions[0][1].rosterIds.length+1;
    expect(()=>copy.expansion!.economy.military.armyPlanner.restore(bad)).toThrow('Invalid army mission');
    copy.restore(game.checkpoint());
    for(let i=0;i<5;i++){
      game.tick+=40;copy.tick+=40;
      planner.step();copy.expansion!.economy.military.armyPlanner.step();
      expect(copy.expansion!.economy.military.armyPlanner.checkpoint()).toEqual(planner.checkpoint());
    }
  });
});
