import { describe, it, expect } from 'vitest';
import { cavalryImpactScene, cavalryRankScene } from './fixtures/CavalryImpact';
import { tacticalFacts } from '../../src/skirmish/domain/FormationTactics';
import { UNIT } from '../../src/skirmish/content/Units';
import { FIXED, secondsToTicks } from '../../src/skirmish/Protocol';
import { cavalryResistance, assaultBonus, assaultWeapon, cavalryWithdrawal } from '../../src/skirmish/domain/CavalryAssault';
import { validateCavalryEngagement } from '../../src/skirmish/domain/CavalryEngagement';
import { CavalryAssaultMotion } from '../../src/skirmish/client/troops/CavalryAssaultPresentation';
import { chargeReadiness, chargeStatus } from '../../src/skirmish/client/ChargeReadiness';
import { SnapshotEncoder, SnapshotDecoder } from '../../src/skirmish/SnapshotCodec';
import { BattleLabModel, battleDefinition } from '../../src/skirmish/client/lab/BattleLabModel';
import { createManpower } from '../../src/skirmish/domain/Manpower';
import { createFormation } from '../../src/skirmish/domain/FormationGeometry';
import { formationApproach } from '../../src/skirmish/domain/FormationContact';
import { cavalryAttackGap, cavalryRankExposure, waveTick } from '../../src/skirmish/domain/CavalryMelee';

function arena(duration = 6) {
  const model = new BattleLabModel([
    { side: 1, definitionId: 'bronzeage-cavalry', soldiers: 16, formations: 1, variant: 'base', shape: 'mass', tuning: {hp: 10000, chargeBonusSeconds: duration} },
    { side: 2, definitionId: 'bronzeage-infantry', soldiers: 24, formations: 1, variant: 'base', shape: 'mass', tuning: {hp: 10000} },
  ], 8);
  model.controlledSide = 1;
  const [rider, defender] = [model.game.squads.find(s => s.playerId === 1)!, model.game.squads.find(s => s.playerId === 2)!];
  expect(model.command({type: 'charge', playerId: 1, squadIds: [rider.id], targetId: defender.id, x: defender.x, y: defender.y})).toBeNull();
  model.start();
  for (let i=0; i<160 && !rider.cavalryEngagement?.assault; i++) model.step();
  expect(rider.cavalryEngagement?.assault).toBeDefined();
  return {model, game:model.game, rider, defender};
}

describe('committed cavalry assault', () => {
  it('uses a per-unit bonus duration, beginning at first contact, and cannot refresh it by reissuing charge', () => {
    expect(UNIT.get('bronzeage-cavalry')!.charge!.bonusDurationTicks).toBe(secondsToTicks(6));
    expect(battleDefinition('bronzeage-cavalry', {chargeBonusSeconds: 2}).charge!.bonusDurationTicks).toBe(secondsToTicks(2));
    const {model,game,rider,defender}=arena(2), a=rider.cavalryEngagement!.assault!;
    expect(a.bonusUntilTick-a.startTick).toBe(secondsToTicks(2));
    expect(a.startTick).toBeGreaterThan(0);
    expect(rider.charge).toBeNull();
    expect(chargeReadiness(rider,a.startTick)).toBe(1);
    expect(chargeReadiness(rider,a.startTick+secondsToTicks(1))).toBe(.5);
    for(let i=0;i<secondsToTicks(1);i++)model.step();
    expect(model.command({type:'charge',playerId:1,squadIds:[rider.id],targetId:defender.id,x:defender.x,y:defender.y})).toBeNull();
    expect(rider.cavalryEngagement!.assault!.bonusUntilTick).toBe(a.bonusUntilTick);
    expect(model.command({type:'charge',playerId:1,squadIds:[rider.id],x:defender.x,y:defender.y})).toBeNull();
    expect(rider.charge).toBeNull();
    expect(rider.cavalryEngagement!.assault!.startTick).toBe(a.startTick);
    expect(assaultBonus(rider,a.bonusUntilTick)).toBe(0);
    expect(chargeStatus(rider,a.bonusUntilTick)).toContain('normal damage');
    expect(game.tick).toBeGreaterThan(a.startTick);
  });

  it('keeps attacking at weapon cadence after the bonus expires, without rank waves or in-combat recovery', () => {
    const {model,game,rider}=arena(), a=rider.cavalryEngagement!.assault!;
    const collected=new Map<number,NonNullable<typeof rider.combatFact>>();
    for(let i=0;i<secondsToTicks(10);i++){
      model.step();if(rider.combatFact)collected.set(rider.combatFact.tick,rider.combatFact);
    }
    const hits=[...collected.values()];
    expect(hits.filter(v=>v.tick>a.startTick&&v.tick<a.bonusUntilTick&&v.charge).length).toBeGreaterThan(1);
    expect(hits.some(v=>v.tick>=a.bonusUntilTick&&!v.charge)).toBe(true);
    expect(rider.cavalryEngagement!.assault!.startTick).toBe(a.startTick);
    expect(rider.cavalryMelee).toBeUndefined();
    expect(rider.chargeReadyTick).toBeGreaterThanOrEqual(game.tick+UNIT.get(rider.definitionId!)!.charge!.cooldownTicks-1);
    const weapon=UNIT.get(rider.definitionId!)!.meleeAttack!;
    expect(assaultWeapon(weapon,UNIT.get(rider.definitionId!)!,assaultBonus(rider,game.tick))).toBe(weapon);
  });

  it('makes facing, deployment and actual fighting strength determine penetration', () => {
    const front=cavalryImpactScene(false,true), flank=cavalryImpactScene(true,true);
    const resolve=(s:ReturnType<typeof cavalryImpactScene>)=>cavalryResistance(s.rider,s.defender,UNIT.get(s.rider.definitionId!)!,UNIT.get(s.defender.definitionId!)!,0);
    expect(resolve(front).penetrates).toBe(false);
    expect(resolve(flank).resistance).toBeLessThan(resolve(front).resistance);
    expect(resolve(flank).penetrates).toBe(true);
    front.game.updateSquad(front.defender.id,{troops:1,formation:{...front.defender.formation!,layoutTroops:1}});
    expect(resolve(front).penetrates).toBe(true);
  });

  it('spends the bonus against a holding line and never grants penetration when terrain certification fails', () => {
    const {game,rider}=cavalryImpactScene(false,true);
    game.step();
    expect(rider.cavalryEngagement!.assault!.penetrates).toBe(false);
    expect(rider.cavalryEngagement!.assault!.bonusUntilTick-rider.cavalryEngagement!.assault!.startTick).toBe(secondsToTicks(6));
    expect(rider.cavalryEngagement!.goalY).toBe(rider.cavalryEngagement!.originY);
    const blocked=cavalryImpactScene(true);
    blocked.game.chargePresentationClear=()=>false;
    blocked.game.step();
    expect(blocked.rider.cavalryEngagement!.assault!.depth).toBe(0);
    expect(blocked.rider.cavalryEngagement!.assault!.approach).toBe(0);
  });

  it('keeps the assault against mounted and hull targets while denying hull penetration', () => {
    for(const id of ['bronzeage-cavalry','bronzeage-siege']){
      const {game,rider,defender}=cavalryImpactScene();
      const unit=UNIT.get(id)!;
      game.updateSquad(defender.id,{definitionId:id,kind:unit.line,troops:unit.formationRecipe!.capacity,manpower:createManpower(unit),formation:createFormation(id)});
      game.updateSquad(rider.id,formationApproach(rider,defender,0,0,-Math.PI/2));
      game.expansion!.battle.fight([]);
      expect(rider.charge).toBeNull();
      expect(rider.cavalryEngagement?.assault).toBeDefined();
      expect(rider.order).toEqual({type:'attack',targetId:defender.id});
      if(unit.formationRecipe!.model==='hull')expect(rider.cavalryEngagement?.assault?.depth).toBe(0);
    }
  });

  it('roundtrips the attack window and resistance through deltas and checkpoint continuation', () => {
    const {game,rider}=cavalryImpactScene();
    const encoder=new SnapshotEncoder(), decoder=new SnapshotDecoder();
    decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    game.step();
    const decoded=decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    const state=structuredClone(rider.cavalryEngagement!);
    expect(decoded.squads.find(s=>s.id===rider.id)!.cavalryEngagement).toEqual(state);
    const saved=game.checkpoint();game.restore(saved);
    expect(game.squad(rider.id)!.cavalryEngagement).toEqual(state);
    expect(()=>validateCavalryEngagement({...state,assault:{...state.assault!,bonusUntilTick:Infinity}},game.tick)).toThrow();
    expect(()=>validateCavalryEngagement({...state,assault:{...state.assault!,nx:10}},game.tick)).toThrow();
    for(let i=0;i<10;i++)game.step();
    const expected=game.checkpoint();
    game.restore(saved);for(let i=0;i<10;i++)game.step();
    expect(game.checkpoint()).toEqual(expected);
  });

  it('uses varied staged passes outside a holding line, and permits only the certified penetration depth', () => {
    const {game,rider}=cavalryImpactScene(false,true);game.step();
    const a=rider.cavalryEngagement!.assault!;
    const members=Array.from({length:16},(_,id)=>({id,x:(a.x-a.nx*80)/FIXED,y:(a.y-a.ny*80)/FIXED,angle:0}));
    const motion=new CavalryAssaultMotion();motion.sample(a,a.startTick,members);
    for(let i=1;i<24;i++)motion.sample(a,a.startTick+i,members);
    const first=motion.sample(a,a.startTick+24,members);
    const next=motion.sample(a,a.startTick+24.01,members);
    expect(first.size).toBe(16);
    expect(new Set([...first.values()].map(p=>`${p.x.toFixed(3)}:${p.y.toFixed(3)}`)).size).toBeGreaterThan(8);
    for(const [id,p] of first){
      const along=(p.x*FIXED-a.x)*a.nx+(p.y*FIXED-a.y)*a.ny;
      expect(along).toBeLessThanOrEqual(0);
      expect(Math.hypot(p.x-next.get(id)!.x,p.y-next.get(id)!.y)).toBeLessThan(.01);
    }
    expect(motion.sample({...a,approach:0},10,members).size).toBe(0);
  });

  it('lets an engaged assault withdraw without auto-attacking again', () => {
    const {model,game,rider}=arena();
    const origin={x:rider.x,y:rider.y};
    const tile=game.map.ref(Math.floor(rider.x/FIXED)-8,Math.floor(rider.y/FIXED));
    expect(model.command({type:'order',playerId:1,squadIds:[rider.id],order:{type:'move',tile}})).toBeNull();
    for(let i=0;i<secondsToTicks(3);i++)model.step();
    expect(rider.order.type).toBe('move');
    expect(rider.cavalryEngagement?.phase).toBe('withdrawing');
    expect(Math.hypot(rider.x-origin.x,rider.y-origin.y)).toBeGreaterThan(FIXED);
  });

  it('keeps withdrawing riders vulnerable from the rear as they turn away', () => {
    const {game,rider,defender}=cavalryImpactScene();game.step();
    game.updateSquad(rider.id,{cavalryEngagement:{...rider.cavalryEngagement!,phase:'withdrawing'},
      locomotion:{heading:Math.PI,targetHeading:Math.PI,speed:1}});
    const facts=tacticalFacts(defender,rider,game.tick,'melee');
    expect(facts.arc).toBe('rear');expect(facts.bp).toBeGreaterThan(10000);
  });

  it('cancels rank damage while retaining exposed riders and obeying the withdrawal order', () => {
    const {game,rider,defender}=cavalryRankScene();game.setAiController(1,false);game.setAiController(2,false);
    game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,shape:'mass',transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'attack',targetId:defender.id,cavalryMode:'ranks'}})).toBeNull();
    for(let i=0;i<50&&!rider.cavalryMelee;i++)game.step();
    const cycle=rider.cavalryMelee!.current;
    while(game.tick<waveTick(cycle,0)+1)game.step();
    expect(cavalryRankExposure(cycle,game.tick)).not.toBe(0);
    expect(cavalryWithdrawal(rider,game.tick)?.withdrawUntilTick).toBeGreaterThan(game.tick);
    const origin={x:rider.x,y:rider.y},tick=game.tick;
    const tile=game.map.ref(Math.floor(rider.x/FIXED),Math.floor(rider.y/FIXED)-8);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'move',tile}})).toBeNull();
    game.step();
    expect(rider.cavalryEngagement?.phase).toBe('withdrawing');
    expect(rider.cavalryMelee?.current.completed).toBe(3);
    for(let i=0;i<secondsToTicks(3);i++)game.step();
    expect(rider.order.type).toBe('move');
    expect(Math.hypot(rider.x-origin.x,rider.y-origin.y)).toBeGreaterThan(FIXED);
    expect(game.volleys.filter(v=>v.squadId===rider.id&&v.tick>tick&&v.melee)).toHaveLength(0);
  });
});
