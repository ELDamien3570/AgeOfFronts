import {TICK_MS} from '../../Protocol';
import {FIXED} from '../../Protocol';
import type {MeleeStrike} from '../../domain/MeleeStrike';
import type {ActorClip} from './TroopFormationModel';
/** Stage committed strikes on their actual edges, independently of cosmetic
 * movement, target survival, facing lag and the transient effect-event budget. */
export function committedMeleeActors(strike:MeleeStrike|undefined,tick:number,clip:ActorClip,soldiers:readonly {id:number;x:number;y:number;scale:number;front?:boolean;angle?:number}[],footprint:number,localContact=false) {
  const result=new Map<number,{time:number;angle:number}>();
  if(!strike || !soldiers.length)return result;
  const elapsed=(tick-strike.tick)*TICK_MS,frames=clip.durations??Array(clip.frameCount).fill(1000/(clip.fps??6));
  const release=frames.slice(0,clip.releaseFrame??0).reduce((a,b)=>a+b,0),duration=frames.reduce((a,b)=>a+b,0),time=release+elapsed;
  if(elapsed<0 || time>=duration)return result;
  for(const contact of strike.contacts){
    const from={x:contact.fromX/FIXED,y:contact.fromY/FIXED},to={x:contact.toX/FIXED,y:contact.toY/FIXED};
    let dx=contact.bearing===undefined?to.x-from.x:Math.cos(contact.bearing),dy=contact.bearing===undefined?to.y-from.y:Math.sin(contact.bearing);
    // At overlapping contact anchors, the body's center still identifies its edge.
    if(Math.hypot(dx,dy)<.001){dx=from.x-soldiers.reduce((n,s)=>n+s.x,0)/soldiers.length;dy=from.y-soldiers.reduce((n,s)=>n+s.y,0)/soldiers.length;}
    if(Math.hypot(dx,dy)<.001)dy=1;
    const length=Math.hypot(dx,dy),nx=dx/length,ny=dy/length;
    const front=Math.max(...soldiers.map(s=>s.x*nx+s.y*ny));
    let nearest=soldiers[0],distance=Infinity;
    let eligible=false;
    const closest=soldiers.reduce((a,b)=>Math.hypot(a.x-from.x,a.y-from.y)<=Math.hypot(b.x-from.x,b.y-from.y)?a:b);
    for(const soldier of soldiers){
      if(localContact && soldier.front===false)continue;
      if(localContact && soldier.angle!==undefined && Math.cos(soldier.angle+Math.PI/2-Math.atan2(ny,nx))<.25)continue;
      eligible=true;
      const d=Math.hypot(soldier.x-from.x,soldier.y-from.y);if(d<distance){distance=d;nearest=soldier;}
      if((localContact || front-(soldier.x*nx+soldier.y*ny)<=soldier.scale*footprint*.55) && !result.has(soldier.id))result.set(soldier.id,{time,angle:localContact?(soldier.angle??Math.atan2(ny,nx)-Math.PI/2):Math.atan2(ny,nx)-Math.PI/2});
    }
    if(eligible && !result.has(nearest.id))result.set(nearest.id,{time,angle:Math.atan2(ny,nx)-Math.PI/2});
    // A committed damage fact must finish even if its opponent dies or moves
    // during recovery. Preserve one local contact actor, not a whole flat edge.
    if(localContact && !eligible && !result.has(closest.id))result.set(closest.id,{time,angle:Math.atan2(to.y-closest.y,to.x-closest.x)-Math.PI/2});
  }
  return result;
}
