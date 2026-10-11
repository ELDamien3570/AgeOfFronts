import {describe,it,expect} from 'vitest';
import {cavalryBattleScene} from './fixtures/CavalryImpact';
import {formationSlots,formationEnvelope,reorientedFormation,createFormation,TURN,validateFormation} from '../../src/skirmish/domain/FormationGeometry';
import {TroopChoreography} from '../../src/skirmish/client/troops/TroopChoreography';
import {FIXED} from '../../src/skirmish/Protocol';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';

describe('position-preserving formation turns',()=>{
  it('preserves the occupied member positions at the start of a turn, including wedge reversals',()=>{
    const {riders}=cavalryBattleScene();
    for(const shape of ['mass','line','wedge','square'] as const){
      const s={...riders[0],formation:{...riders[0].formation!,shape,transition:undefined}};
      for(const facing of [TURN/2,TURN/4,TURN*3/8]){
        const source=formationSlots(s,0),formation=reorientedFormation(s,0,facing),turned={...s,formation},angle=formationEnvelope(turned,0).angle;
        const world=formationSlots(turned,0).map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
        for(const p of source)expect(Math.min(...world.map(q=>Math.hypot(p.x-q.x,p.y-q.y)))).toBeLessThan(1);
      }
    }
  });
  it('retains rider identities in place when reversing the coordinate frame',()=>{
    const slots=[{x:-1,y:1,row:1,scale:.2},{x:1,y:-1,row:0,scale:.2}];
    const motion=new TroopChoreography(slots,0,0,2),before=motion.formationSoldiers(0);
    motion.rebaseFrame(Math.PI);
    motion.applyAuthoritative(slots,2,0);
    for(const p of motion.formationSoldiers(0)){
      const old=before.find(q=>q.id===p.id)!;
      expect(-p.x).toBeCloseTo(old.x);expect(-p.y).toBeCloseTo(old.y);
    }
  });
  it('retains compiled assignments throughout a morph instead of changing identities each frame',()=>{
    const slots=[{x:-1,y:0,row:0,scale:.2},{x:1,y:0,row:0,scale:.2}],motion=new TroopChoreography(slots,0,0,2);
    const ids=motion.formationSoldiers(0).map(p=>p.id);
    motion.applyAuthoritative([{...slots[0],x:1},{...slots[1],x:-1}],2,20,undefined,true);
    expect(motion.formationSoldiers(20).map(p=>p.id)).toEqual(ids);
    expect(motion.formationSoldiers(20)[0].x).toBe(1);
  });
  it('uses a translation-admitted reform for a real reversal and round-trips it through snapshots',()=>{
    const {game,riders,defenders}=cavalryBattleScene(),s=riders[0];
    for(const t of [...riders.slice(1),...defenders])game.removeSquad(t.id);
    game.updateSquad(s.id,{formation:{...createFormation(s.definitionId),shape:'line'},locomotion:{heading:0,targetHeading:0,speed:0}});
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[s.id],order:{type:'move',tile:game.map.ref(26,17)}})).toBeNull();
    let observed=false;
    for(let i=0;i<80;i++){
      game.step();
      if(s.formation?.transition?.reorientation){
        observed=true;validateFormation(s.formation,s.definitionId,s.troops);
        const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()));
        expect(decoded.squads.find(q=>q.id===s.id)!.formation).toEqual(s.formation);
      }
    }
    expect(observed).toBe(true);expect(s.y).toBeLessThan(25*FIXED);
  });
  it('restores the active coordinate reform and continues deterministically',()=>{
    const {game,riders}=cavalryBattleScene(),s=riders[0];
    game.updateSquad(s.id,{formation:reorientedFormation({...s,formation:{...s.formation!,shape:'line'}},game.tick,TURN/4)});
    const restored=cavalryBattleScene().game;restored.restore(game.checkpoint());
    for(let i=0;i<45;i++){game.step();restored.step();}
    expect(restored.snapshot()).toEqual(game.snapshot());
  });
});
