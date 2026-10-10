import {predictiveAim} from "../src/skirmish/RangedAim";
import {circleSweepEntry} from "../src/skirmish/domain/ProjectileCollision";
const results=[];
for(const velocity of [{x:0,y:0},{x:80,y:0},{x:-80,y:0},{x:0,y:80}]){
 let hits=0;
 for(let seed=0;seed<10000;seed++){
  const aim=predictiveAim({x:0,y:0},{x:384,y:0},velocity,512,seed,Number(process.argv[2] ?? 4)),steps=Math.ceil(aim.seconds*20);let old={x:0,y:0},hit=false;
  for(let step=1;step<=steps;step++){
   const fraction=Math.min(1,step/steps),point={x:aim.point.x*fraction,y:aim.point.y*fraction},target={x:384+velocity.x*step/20,y:velocity.y*step/20};
   if(circleSweepEntry(old,point,target,32)!==null){hit=true;break;}old=point;
  }
  if(hit)hits++;
 }
 results.push({velocity,hits: hits/10000});
}
console.log(JSON.stringify(results));
