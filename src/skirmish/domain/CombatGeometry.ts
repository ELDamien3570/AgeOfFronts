import type { Squad } from '../Protocol';
import { formationEnvelope } from './FormationGeometry';
import { PreparedFormationBody, type FormationContact } from './FormationContact';

interface Pose {
  x:number; y:number; troops:number; definition?:string; kind:Squad['kind'];
  formation:Squad['formation']; capacity?:number; variant?:string; charge?:string;
  tick:number; envelope:ReturnType<typeof formationEnvelope>;
  body?:PreparedFormationBody;
}
/** Exact prepared geometry. Domain formation containers are immutable;
 * owned scalar records can move or lose soldiers, so every lookup checks those inputs.
 * No hull approximation or historical pose is introduced here.
 */
export class CombatGeometry {
  private readonly poses = new WeakMap<Squad,Pose>();
  private pose(s:Squad,tick:number):Pose {
    const old=this.poses.get(s), time=s.formation?.transition?tick:0;
    if(old && old.x===s.x && old.y===s.y && old.troops===s.troops && old.definition===s.definitionId &&
      old.kind===s.kind && old.formation===s.formation && old.capacity===s.manpower?.capacity &&
      old.variant===s.manpower?.variant && old.charge===s.charge?.phase && old.tick===time)return old;
    const envelope=formationEnvelope(s,tick);
    const value={x:s.x,y:s.y,troops:s.troops,definition:s.definitionId,kind:s.kind,formation:s.formation,
      capacity:s.manpower?.capacity,variant:s.manpower?.variant,charge:s.charge?.phase,tick:time,
      envelope};
    this.poses.set(s,value);return value;
  }
  envelope(s:Squad,tick:number) { return this.pose(s,tick).envelope; }
  body(s:Squad,tick:number):PreparedFormationBody {
    const pose=this.pose(s,tick);
    return pose.body ?? (pose.body=new PreparedFormationBody(s,tick,pose.envelope));
  }
  contact(a:Squad,b:Squad,tick:number):FormationContact {
    return this.body(a,tick).contact(this.body(b,tick));
  }
  withinReach(a:Squad,b:Squad,tick:number,reach:number):boolean {
    const ae=this.envelope(a,tick),be=this.envelope(b,tick),dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
    if(dx>ae.halfX+be.halfX+reach || dy>ae.halfY+be.halfY+reach)return false;
    const radius=ae.broadRadius+be.broadRadius+reach;return dx*dx+dy*dy<=radius*radius;
  }
  lowerBound(a:Squad,b:Squad,tick:number):number {
    const ae=this.envelope(a,tick),be=this.envelope(b,tick);
    const dx=Math.max(0,Math.abs(b.x-a.x)-ae.halfX-be.halfX),dy=Math.max(0,Math.abs(b.y-a.y)-ae.halfY-be.halfY);
    return dx*dx+dy*dy;
  }
}
