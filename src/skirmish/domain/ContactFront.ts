import { polygonSweepEntry, type CollisionPoint as Point } from './ProjectileCollision';

export function nearestContactPoint(origin:Point,body:readonly Point[]):Point|undefined {
  let nearest:Point|undefined,best=Infinity;
  for(let i=0;i<body.length;i++){
    const a=body[i],b=body[(i+1)%body.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((origin.x-a.x)*dx+(origin.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    const p={x:a.x+dx*t,y:a.y+dy*t},distance=(p.x-origin.x)**2+(p.y-origin.y)**2;
    if(distance<best){best=distance;nearest=p;}
  }
  return nearest;
}

/** A bounded contact path, not a soldier navigation request. Keeps the original
 * file when it intersects the body; bends toward its nearest edge otherwise. */
export function contactPath(origin:Point,body:readonly Point[],bearing:number,length:number,lateral:number,depth=0) {
  const nx=Math.cos(bearing),ny=Math.sin(bearing);
  const end={x:origin.x+nx*length,y:origin.y+ny*length};
  const entry=polygonSweepEntry(origin,end,body);
  if(entry!==null){
    const travel=Math.min(length,entry*length+depth);
    return {bearing,distance:travel,point:{x:origin.x+nx*travel,y:origin.y+ny*travel}};
  }
  const nearest=nearestContactPoint(origin,body);
  if(!nearest)return undefined;
  const dx=nearest.x-origin.x,dy=nearest.y-origin.y,forward=dx*nx+dy*ny,side=-dx*ny+dy*nx;
  if(forward<0 || Math.abs(side)>lateral || Math.hypot(dx,dy)>length)return undefined;
  const direction=Math.atan2(dy,dx),travel=Math.min(length,Math.hypot(dx,dy)+depth);
  return {bearing:direction,distance:travel,point:{x:origin.x+Math.cos(direction)*travel,y:origin.y+Math.sin(direction)*travel}};
}
