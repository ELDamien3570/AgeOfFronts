import { CAVALRY_RANK_TURN_SPEED } from '../../domain/CavalryMelee';
const TURN_RATE=Math.PI*.75*CAVALRY_RANK_TURN_SPEED;
type Pose={id:number;x:number;y:number;angle:number};
type Carrier={x:number;y:number};
interface Rider extends Pose {vx:number;vy:number;targetX:number;targetY:number;settling:boolean;gait:number}
/** Visible-pose handoff only: commands and damage never wait for this follower.
 * Nominal rank paths are unchanged. Interrupted paths retain their last drawn
 * world position and velocity, then converge with bounded speed/acceleration. */
export class CavalryPoseContinuity {
  private riders=new Map<number,Rider>();
  private key:string|undefined;
  private time:number|undefined;
  private carrier:Carrier|undefined;
  lastPose(id:number):Pose|undefined {
    const rider=this.riders.get(id);return rider?{id,x:rider.x,y:rider.y,angle:rider.angle}:undefined;
  }
  sample(key:string,now:number,poses:readonly Pose[],carrier?:Carrier):Map<number,Pose&{recovering:boolean;moving:boolean;gaitDistance:number}>{
    const membershipChanged=this.riders.size!==poses.length||poses.some(p=>!this.riders.has(p.id));
    const dt=Math.min(.05,Math.max(0,(now-(this.time??now))/1000)),changed=this.key!==undefined&&(key!==this.key||membershipChanged);
    this.key=key;this.time=now;
    const result=new Map<number,Pose&{recovering:boolean;moving:boolean;gaitDistance:number}>(),seen=new Set<number>();
    const previousCarrier=this.carrier;
    this.carrier=carrier?{...carrier}:undefined;
    for(const target of poses){
      seen.add(target.id);let rider=this.riders.get(target.id);
      if(!rider){rider={...target,vx:0,vy:0,targetX:target.x,targetY:target.y,settling:false,gait:0};this.riders.set(target.id,rider);}
      const oldX=rider.x,oldY=rider.y;
      // Carry translation exactly once. Facing changes are individual pivots,
      // never an orbital transform of the rider's world position.
      if(carrier && previousCarrier){
        const dx=carrier.x-previousCarrier.x,dy=carrier.y-previousCarrier.y;
        rider.x+=dx;rider.y+=dy;rider.targetX+=dx;rider.targetY+=dy;
      }
      const angularError=Math.atan2(Math.sin(target.angle-rider.angle),Math.cos(target.angle-rider.angle));
      if(changed&&(Math.hypot(target.x-rider.x-rider.vx*dt,target.y-rider.y-rider.vy*dt)>.04||Math.abs(angularError)>TURN_RATE*dt+.05))rider.settling=true;
      if(!rider.settling){
        rider.vx=dt?(target.x-rider.x)/dt:0;rider.vy=dt?(target.y-rider.y)/dt:0;
        Object.assign(rider,target);
      }else if(dt){
        const limit=(x:number,y:number,maximum:number)=>{const length=Math.hypot(x,y),scale=length>maximum?maximum/length:1;return {x:x*scale,y:y*scale};};
        const targetVelocity=changed?{x:0,y:0}:limit((target.x-rider.targetX)/dt,(target.y-rider.targetY)/dt,2.25);
        const acceleration=limit(64*(target.x-rider.x)+16*(targetVelocity.x-rider.vx),64*(target.y-rider.y)+16*(targetVelocity.y-rider.vy),6);
        const velocity=limit(rider.vx+acceleration.x*dt,rider.vy+acceleration.y*dt,2.25);
        rider.vx=velocity.x;rider.vy=velocity.y;rider.x+=velocity.x*dt;rider.y+=velocity.y*dt;
        rider.angle+=Math.max(-TURN_RATE*dt,Math.min(TURN_RATE*dt,angularError));
        if(Math.hypot(target.x-rider.x,target.y-rider.y)<.003&&Math.hypot(rider.vx-targetVelocity.x,rider.vy-targetVelocity.y)<.03&&Math.abs(angularError)<.01){
          Object.assign(rider,target);rider.settling=false;
        }
      }
      rider.targetX=target.x;rider.targetY=target.y;
      rider.gait+=Math.hypot(rider.x-oldX,rider.y-oldY);
      result.set(target.id,{id:rider.id,x:rider.x,y:rider.y,angle:rider.angle,recovering:rider.settling,moving:Math.hypot(rider.x-oldX,rider.y-oldY)>.001*dt || Math.hypot(rider.vx,rider.vy)>.001,gaitDistance:rider.gait});
    }
    for(const id of this.riders.keys())if(!seen.has(id))this.riders.delete(id);
    return result;
  }
}
