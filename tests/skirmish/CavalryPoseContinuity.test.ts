import { describe,it,expect } from 'vitest';
import { CavalryPoseContinuity } from '../../src/skirmish/client/troops/CavalryPoseContinuity';
import { CAVALRY_RANK_TURN_SPEED } from '../../src/skirmish/domain/CavalryMelee';
const pose=(x:number,y=0,angle=0)=>({id:1,x,y,angle});
describe('cavalry retarget presentation',()=>{
  it('settles interrupted offsets while the squad travels faster than local recovery',()=>{
    const handoff=new CavalryPoseContinuity();handoff.sample('attack',0,[pose(1)],{x:0,y:0});
    handoff.sample('travel',0,[pose(0)],{x:0,y:0});
    let last=handoff.lastPose(1)!;
    for(let now=20;now<=4000;now+=20){
      const x=now/1000*4,next=handoff.sample('travel',now,[pose(x)],{x,y:0}).get(1)!;
      expect(next.x-x).toBeLessThanOrEqual(1.01);
      expect(Math.abs(next.x-last.x-.08)).toBeLessThanOrEqual(.045001);
      last=next;
    }
    expect(last.x).toBeCloseTo(16,3);
  });
  it('turns an interrupted rider independently without orbiting its position',()=>{
    const handoff=new CavalryPoseContinuity();handoff.sample('old',0,[pose(1)],{x:0,y:0});
    handoff.sample('travel',0,[pose(.5,0,Math.PI)],{x:0,y:0});
    const next=handoff.sample('travel',20,[pose(2.5,0,Math.PI)],{x:2,y:0}).get(1)!;
    expect(next.x).toBeGreaterThan(2.95);expect(next.y).toBe(0);
    expect(next.angle).toBeGreaterThan(0);expect(next.angle).toBeLessThan(.1);
  });
  it('preserves the drawn position on interruption, bounds the return, and settles',()=>{
    const handoff=new CavalryPoseContinuity();handoff.sample('old',0,[pose(1)]);
    const interrupted=handoff.sample('cancelled',0,[pose(0)]).get(1)!;
    expect(interrupted.x).toBe(1);expect(interrupted.recovering).toBe(true);
    let last=interrupted;
    for(let now=20;now<=4000;now+=20){
      const next=handoff.sample('cancelled',now,[pose(0)]).get(1)!;
      expect(Math.hypot(next.x-last.x,next.y-last.y)).toBeLessThanOrEqual(2.25*.02+.000001);
      last=next;
    }
    expect(last.x).toBe(0);expect(last.recovering).toBe(false);
  });
  it('redirects repeated orders from the current pose instead of replaying an old offset',()=>{
    const handoff=new CavalryPoseContinuity();handoff.sample('first',0,[pose(1)]);
    handoff.sample('move',0,[pose(0)]);
    const returning=handoff.sample('move',100,[pose(0)]).get(1)!;
    const redirected=handoff.sample('second',100,[pose(-1,1,Math.PI)]).get(1)!;
    expect(redirected.x).toBe(returning.x);expect(redirected.y).toBe(returning.y);
    const next=handoff.sample('second',120,[pose(-1,1,Math.PI)]).get(1)!;
    expect(Math.hypot(next.x-returning.x,next.y-returning.y)).toBeLessThanOrEqual(.045001);
    expect(Math.abs(next.angle-returning.angle)).toBeLessThanOrEqual(Math.PI*.75*CAVALRY_RANK_TURN_SPEED*.02+.000001);
  });
  it('leaves normal paths exact and drops dead rider state',()=>{
    const handoff=new CavalryPoseContinuity();handoff.sample('cycle',0,[pose(0)]);
    expect(handoff.sample('cycle',20,[pose(.02)]).get(1)!.x).toBe(.02);
    handoff.sample('cycle',40,[]);
    expect(handoff.sample('new',60,[pose(4)]).get(1)!.x).toBe(4);
  });
  it('keeps a survivor continuous when casualty reseating changes its destination without changing the attack',()=>{
    const handoff=new CavalryPoseContinuity();
    handoff.sample('same-cycle',0,[pose(1),{...pose(0),id:2}]);
    expect(handoff.lastPose(2)?.x).toBe(0);
    const survivor=handoff.sample('same-cycle',0,[pose(0)]).get(1)!;
    expect(survivor.x).toBe(1);expect(survivor.recovering).toBe(true);
    expect(handoff.lastPose(2)).toBeUndefined();
    expect(handoff.sample('same-cycle',20,[pose(0)]).get(1)!.x).toBeGreaterThan(.95);
  });
});
