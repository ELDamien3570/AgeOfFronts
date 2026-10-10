import {describe,expect,it} from "vitest";
import {predictiveAim} from "../../src/skirmish/RangedAim";
import {circleSweepEntry} from "../../src/skirmish/domain/ProjectileCollision";
function accuracy(velocity: {x:number;y:number}, turn=false) {
  let hits=0;
  for(let seed=0;seed<2000;seed++) {
    const aim=predictiveAim({x:0,y:0},{x:384,y:0},velocity,512,seed,4);
    const steps=Math.ceil(aim.seconds*20);let old={x:0,y:0};
    for(let step=1;step<=steps;step++) {
      const fraction=Math.min(1,step/steps),point={x:aim.point.x*fraction,y:aim.point.y*fraction};
      const time=step/20, first=turn?Math.min(time,aim.seconds/2):time, second=time-first;
      const target={x:384+velocity.x*first-velocity.y*second,y:velocity.y*first+velocity.x*second};
      if(circleSweepEntry(old,point,target,32)!==null){hits++;break;}old=point;
    }
  }
  return hits/2000;
}
describe("production predictive aim with swept collision",()=>{
  it.each([{x:80,y:0},{x:-80,y:0},{x:0,y:80}])("hits about 70 percent of steady targets %j",velocity=>{
    expect(accuracy(velocity)).toBeGreaterThan(.67);
    expect(accuracy(velocity)).toBeLessThan(.77);
  });
  it("does not home after a target changes course",()=>expect(accuracy({x:0,y:80},true)).toBeLessThan(accuracy({x:0,y:80})-.08));
});
