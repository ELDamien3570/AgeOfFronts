import { describe,it,expect } from 'vitest';
import { contactPath } from '../../src/skirmish/domain/ContactFront';
import { cavalryCohort,cavalryWaves } from '../../src/skirmish/client/troops/CavalryMeleePresentation';
import { waveTick } from '../../src/skirmish/domain/CavalryMelee';
import { cavalryRanks,waveDamage } from '../../src/skirmish/domain/CavalryMelee';
import { chargeReactions } from '../../src/skirmish/client/troops/ChargeImpactPresentation';
import { polygonSweepEntry } from '../../src/skirmish/domain/ProjectileCollision';

const body=[{x:0,y:256},{x:256,y:256},{x:256,y:512},{x:0,y:512}];
describe('bounded corner contact front',()=>{
  it('keeps formation ranks at oblique bearings and pays only reachable waves',()=>{
    const members=[{id:0,x:-1,y:1},{id:1,x:1,y:1},{id:2,x:-1,y:0},{id:3,x:1,y:0}];
    const ranks=cavalryRanks(members,Math.PI/2,.4);
    expect(ranks.get(0)).toBe(ranks.get(1));expect(ranks.get(2)).toBe(ranks.get(3));
    const c={tick:0,interval:216,completed:0,troops:4,orderRevision:0,definitionId:'bronzeage-cavalry',contacts:[]};
    expect(waveDamage(c,1000,0,4,[0,2,1])).toBe(0);
    expect(waveDamage(c,1000,1,4,[0,2,1])+waveDamage(c,1000,2,4,[0,2,1])).toBe(1);
  });
  it('keeps ordinary corner hit reactions local to the contact',()=>{
    const impact={tick:1,role:'defender' as const,sourceId:1,disruptedUntilTick:1,x:0,y:0,dx:16,dy:0,participants:2,radius:64};
    const members=[0,.2,1].map((x,id)=>({id,x,y:0,angle:0,scale:.2}));
    expect([...chargeReactions(impact,2,members).keys()]).toEqual([0,1]);
  });
  it('keeps intersecting files straight, bends near-corner files, and rejects distant files',()=>{
    expect(contactPath({x:128,y:0},body,Math.PI/2,512,64,16)?.bearing).toBe(Math.PI/2);
    const near=contactPath({x:280,y:0},body,Math.PI/2,512,64,16)!;
    expect(near.bearing).toBeGreaterThan(Math.PI/2);
    expect(polygonSweepEntry({x:280,y:0},near.point,body)).not.toBeNull();
    expect(contactPath({x:400,y:0},body,Math.PI/2,512,64,16)).toBeUndefined();
  });
  it('does not animate attacks for cavalry files that miss a corner',()=>{
    const c={tick:0,interval:216,completed:0,troops:3,orderRevision:0,definitionId:'bronzeage-cavalry',
      contacts:[{targetId:1,budget:1000,lunge:512,reshape:64,strikeDepth:16,targetBody:body,bearing:Math.PI/2,fromX:256,fromY:0,toX:256,toY:256}]};
    const members=[.5,1.09,1.6].map((x,id)=>({id,x,y:0,scale:.2}));
    const cohort=cavalryCohort(c,members);
    const waves=cavalryWaves({current:c},waveTick(c,0),{id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10},members,new Map([[0,cohort]]));
    expect(waves.has(0)).toBe(true);expect(waves.has(1)).toBe(true);expect(waves.has(2)).toBe(false);
    expect(waves.get(1)!.x).toBeLessThan(members[1].x);
  });
});
