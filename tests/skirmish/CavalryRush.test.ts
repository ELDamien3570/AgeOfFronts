import {describe,it,expect} from 'vitest';
import {cavalryBattleScene,cavalryImpactScene} from './fixtures/CavalryImpact';
import {formationEnvelope,createFormation} from '../../src/skirmish/domain/FormationGeometry';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
import {UNIT} from '../../src/skirmish/content/Units';
import {FIXED} from '../../src/skirmish/Protocol';
import {formationApproach} from '../../src/skirmish/domain/FormationContact';
import {cavalryAttackGap} from '../../src/skirmish/domain/CavalryMelee';

describe('responsive mounted rush',()=>{
  it('moves while morphing instead of waiting for the wedge to finish',()=>{
    const {game,riders,defenders}=cavalryBattleScene(),s=riders[0],target=defenders[0],y=s.y;
    expect(game.applyCommand({type:'charge',playerId:1,squadIds:[s.id],x:target.x,y:target.y,targetId:target.id})).toBeNull();
    expect(s.charge?.phase).toBe('approach');expect(s.formation?.transition).toBeDefined();
    for(let i=0;i<10;i++)game.step();
    expect(s.y).toBeGreaterThan(y);expect(s.formation?.transition).toBeDefined();
    expect(formationEnvelope(s,game.tick).shape).toBe('wedge');
  });
  it('keeps infantry in its authored shape during a charge',()=>{
    const {rider}=cavalryImpactScene();
    for(const shape of ['mass','line','shield-wall'] as const){
      const infantry={...rider,definitionId:'bronzeage-infantry',formation:{...createFormation('bronzeage-infantry'),shape}};
      expect(formationEnvelope(infantry,0).shape).toBe(shape);
    }
  });
  it('unfolds a marching column into its rush while moving',()=>{
    const {game,riders,defenders}=cavalryBattleScene(),s=riders[0],target=defenders[0],y=s.y;
    game.updateSquad(s.id,{formation:{...s.formation!,shape:'column',mode:'travel',deployedShape:'mass',transition:undefined}});
    expect(game.applyCommand({type:'charge',playerId:1,squadIds:[s.id],x:target.x,y:target.y,targetId:target.id})).toBeNull();
    expect(s.formation?.transition?.from).toBe('column');
    for(let i=0;i<10;i++)game.step();
    expect(s.y).toBeGreaterThan(y);expect(formationEnvelope(s,game.tick).shape).toBe('wedge');
  });
  it('captures partial stamina and preserves it and run-up clocks on repeated commands',()=>{
    const {game,riders,defenders}=cavalryBattleScene(),s=riders[0],target=defenders[0];
    const cooldown=UNIT.get(s.definitionId!)!.charge!.cooldownTicks;
    game.updateSquad(s.id,{chargeReadyTick:game.tick+cooldown/2});
    const command={type:'charge' as const,playerId:1,squadIds:[s.id],x:target.x,y:target.y,targetId:target.id};
    expect(game.applyCommand(command)).toBeNull();expect(s.charge?.strength).toBe(.5);
    game.step();const start=s.charge!.startTick;
    expect(game.applyCommand(command)).toBeNull();expect(s.charge?.strength).toBe(.5);expect(s.charge?.startTick).toBe(start);
    const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()));
    expect(decoded.squads.find(q=>q.id===s.id)!.charge).toEqual(s.charge);
  });
  it('pays less impact damage and enters less deeply when exhausted, but still enters melee',()=>{
    const impact=(strength:number)=>{
      const {game,rider,defender}=cavalryImpactScene();
      game.updateSquad(rider.id,{charge:{...rider.charge!,strength}});
      const before=defender.troops*defender.manpower!.hp-defender.manpower!.wounds;
      game.expansion!.battle.fight([]);
      const e=rider.cavalryEngagement!;
      return {damage:before-(defender.troops*defender.manpower!.hp-defender.manpower!.wounds),depth:Math.hypot(e.goalX-e.originX,e.goalY-e.originY)};
    };
    const strong=impact(1),weak=impact(0);
    expect(weak.damage).toBeGreaterThan(0);expect(weak.damage).toBeLessThan(strong.damage);
    expect(weak.depth).toBeGreaterThan(0);expect(weak.depth).toBeLessThan(strong.depth);
    expect(strong.depth).toBeLessThanOrEqual(1.5*FIXED);
  });
  it('can rush from an ordinary melee stand-off without getting stuck in approach',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,chargeReadyTick:10000,formation:{...rider.formation!,shape:'mass',transition:undefined},locomotion:{heading:0,targetHeading:0,speed:0}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    expect(game.applyCommand({type:'charge',playerId:1,squadIds:[rider.id],x:defender.x,y:defender.y,targetId:defender.id})).toBeNull();
    let entered=false;
    for(let i=0;i<120;i++){game.step();if(rider.cavalryEngagement)entered=true;}
    expect(entered,JSON.stringify({charge:rider.charge,motion:rider.locomotion,position:[rider.x,rider.y],defender:[defender.x,defender.y],troops:rider.troops,formation:rider.formation})).toBe(true);
  });
});
