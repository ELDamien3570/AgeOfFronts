import {TICKS_PER_SECOND} from '../../src/skirmish/Protocol';
const presentationTicks=(seconds:number)=>seconds*TICKS_PER_SECOND;
import {secondsToTicks} from '../../src/skirmish/Protocol';
import {describe,it,expect} from 'vitest';
import {committedMeleeActors} from '../../src/skirmish/client/troops/TroopMeleeStrike';
import {validateMeleeStrike} from '../../src/skirmish/domain/MeleeStrike';
import {FIXED} from '../../src/skirmish/Protocol';
import type {ActorClip} from '../../src/skirmish/client/troops/TroopFormationModel';
const clip:ActorClip={id:'attack',file:'attack.png',frameCount:6,fps:6,frames:[]};
const soldiers=Array.from({length:9},(_,id)=>({id,x:id%3-1,y:Math.floor(id/3)-1,scale:.3,speed:1,turning:true,facingError:Math.PI,front:false}));
const strike={tick:presentationTicks(0.5),contacts:[{targetId:2,fromX:0,fromY:FIXED,toX:0,toY:2*FIXED},{targetId:3,fromX:FIXED,fromY:0,toX:2*FIXED,toY:0}]};
describe('committed melee presentation',()=>{
 it('keeps committed hits local when the live contact eligibility disappears',()=>{
  expect([...committedMeleeActors(strike,presentationTicks(0.6),clip,soldiers,1,true).keys()].sort()).toEqual([5,7]);
  const live=soldiers.map(p=>({...p,front:p.id===6||p.id===7,angle:0}));
  expect([...committedMeleeActors({tick:presentationTicks(0.5),contacts:[strike.contacts[0]]},presentationTicks(0.6),clip,live,1,true).keys()].sort()).toEqual([6,7]);
 });
 it('plays front and flank strikes even while moving, misaligned and not cosmetically front eligible',()=>{
  const actors=committedMeleeActors(strike,presentationTicks(0.6),clip,soldiers,1);
  expect([...actors.keys()].sort()).toEqual([2,5,6,7,8]);
  expect(actors.get(7)!.time).toBeCloseTo(100);expect(actors.get(7)!.angle).toBe(0);
  expect(actors.get(5)!.angle).toBeCloseTo(-Math.PI/2);
 });
 it('finishes a committed strike without requiring a living target or replaying it on repeated snapshots',()=>{
  expect(committedMeleeActors(strike,presentationTicks(0.75),clip,soldiers,1).get(7)!.time).toBe(250);
  expect(committedMeleeActors(strike,presentationTicks(0.75),clip,soldiers,1).get(7)!.time).toBe(250);
  expect(committedMeleeActors(strike,presentationTicks(1.5),clip,soldiers,1).size).toBe(0);
  expect(committedMeleeActors(undefined,presentationTicks(0.75),clip,soldiers,1).size).toBe(0);
 });
 it('uses authored clip duration and rejects future, malformed or unbounded facts',()=>{
  expect(committedMeleeActors(strike,presentationTicks(0.6),{...clip,durations:[30,30]},soldiers,1).size).toBe(0);
  expect(()=>validateMeleeStrike(strike,presentationTicks(0.5))).not.toThrow();
  expect(()=>validateMeleeStrike(strike,presentationTicks(0.45))).toThrow();
  expect(()=>validateMeleeStrike({...strike,contacts:Array(9).fill(strike.contacts[0])})).toThrow();
  expect(()=>validateMeleeStrike({...strike,contacts:[{...strike.contacts[0],fromX:NaN}]})).toThrow();
 });
 it('shows the authored contact frame on the damage tick and ends at the recovery deadline',()=>{
  const authored={...clip,durations:[100,200,200,100,100,100],releaseFrame:3};
  expect(committedMeleeActors(strike,presentationTicks(0.5),authored,soldiers,1).get(7)!.time).toBe(500);
  expect(committedMeleeActors(strike,presentationTicks(0.75),authored,soldiers,1).get(7)!.time).toBe(750);
  expect(committedMeleeActors(strike,presentationTicks(0.8),authored,soldiers,1).size).toBe(0);
 });
 it('distinguishes two edges even when overlapping contact anchors coincide',()=>{
  const overlap={tick:presentationTicks(0.5),contacts:[{fromX:FIXED,fromY:FIXED,toX:FIXED,toY:FIXED,bearing:Math.PI/2},{fromX:FIXED,fromY:FIXED,toX:FIXED,toY:FIXED,bearing:0}]};
  expect([...committedMeleeActors(overlap,presentationTicks(0.6),clip,soldiers,1).keys()].sort()).toEqual([2,5,6,7,8]);
 });
});
