import {FIXED} from '../../Protocol';
import type {MeleeStrike} from '../../domain/MeleeStrike';
import type {ActorClip} from './TroopFormationModel';
/** Stage committed strikes on their actual edges, independently of cosmetic
 * movement, target survival, facing lag and the transient effect-event budget. */
export function committedMeleeActors(strike:MeleeStrike|undefined,tick:number,clip:ActorClip,soldiers:readonly {id:number;x:number;y:number;scale:number}[],footprint:number) {
  const result=new Map<number,{time:number;angle:number}>();
  if(!strike || !soldiers.length)return result;
  const elapsed=(tick-strike.tick)*50,frames=clip.durations??Array(clip.frameCount).fill(1000/(clip.fps??6));
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
    for(const soldier of soldiers){
      const d=Math.hypot(soldier.x-from.x,soldier.y-from.y);if(d<distance){distance=d;nearest=soldier;}
      if(front-(soldier.x*nx+soldier.y*ny)<=soldier.scale*footprint*.55 && !result.has(soldier.id))result.set(soldier.id,{time,angle:Math.atan2(ny,nx)-Math.PI/2});
    }
    if(!result.has(nearest.id))result.set(nearest.id,{time,angle:Math.atan2(ny,nx)-Math.PI/2});
  }
  return result;
}
