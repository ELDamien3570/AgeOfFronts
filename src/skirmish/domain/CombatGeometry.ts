import type { Squad } from '../Protocol';
import { formationEnvelope, geometryKey, physicalGeometryKey } from './FormationGeometry';
import { PreparedFormationBody, type FormationContact } from './FormationContact';

interface Pose {
  x:number; y:number; troops:number; definition?:string; kind:Squad['kind'];
  formation:Squad['formation']; capacity?:number; variant?:string; charge?:string;
  tick:number; envelope:ReturnType<typeof formationEnvelope>;
  physicalKey?:string;
  body?:PreparedFormationBody;
}
type EnvelopePose = Omit<Pose, 'x' | 'y' | 'body'>;
/** Exact prepared geometry. Domain formation containers are immutable;
 * owned scalar records can move or lose soldiers, so every lookup checks those inputs.
 * No hull approximation or historical pose is introduced here.
 */
export class CombatGeometry {
  readonly telemetry = { envelopeReads: 0, envelopeBuilds: 0, metadataReuses: 0, projectedReuses: 0, bodyBuilds: 0 };
  private readonly poses = new WeakMap<Squad,Pose>();
  private readonly envelopes = new WeakMap<Squad,EnvelopePose>();
  // Owned and hypothetical records share physical identity. A bounded history
  // retains current, next-tick and settled poses without retaining their inputs.
  private readonly envelopeHistory=new Map<number,{key:string;kind:Squad['kind'];tick:number;x?:number;y?:number;envelope:ReturnType<typeof formationEnvelope>}[]>();
  private pose(s:Squad,tick:number):Pose {
    const old=this.poses.get(s), time=s.formation?.transition?tick:0;
    if(old && old.x===s.x && old.y===s.y && old.troops===s.troops && old.definition===s.definitionId &&
      old.kind===s.kind && old.formation===s.formation && old.capacity===s.manpower?.capacity &&
      old.variant===s.manpower?.variant && old.charge===s.charge?.phase && old.tick===time)return old;
    const envelope=this.envelope(s,tick);
    const value={x:s.x,y:s.y,troops:s.troops,definition:s.definitionId,kind:s.kind,formation:s.formation,
      capacity:s.manpower?.capacity,variant:s.manpower?.variant,charge:s.charge?.phase,tick:time,
      envelope};
    this.poses.set(s,value);return value;
  }
  envelope(s:Squad,tick:number) {
    this.telemetry.envelopeReads++;
    // Dimensions and facing depend on the formation, not its translated root.
    // Spatial rebuilds after movement must not prepare a new full world pose
    // for an envelope-only read. Body/contact lookup still checks x and y.
    const old=this.envelopes.get(s), time=s.formation?.transition?tick:0;
    if(old && old.troops===s.troops && old.definition===s.definitionId &&
      old.kind===s.kind && old.formation===s.formation && old.capacity===s.manpower?.capacity &&
      old.variant===s.manpower?.variant && old.charge===s.charge?.phase && old.tick===time)return old.envelope;
    const physicalKey=physicalGeometryKey(s);
    const reusable=old && old.kind===s.kind && old.tick===time && old.physicalKey===physicalKey;
    const positional=!!(s.formation?.trail||s.formation?.occupationSlots||s.formation?.transition?.fromSlots),x=positional?s.x:undefined,y=positional?s.y:undefined;
    let history=this.envelopeHistory.get(s.id),shared:ReturnType<typeof formationEnvelope>|undefined;
    if(!reusable&&history)for(let i=history.length-1;i>=0;i--){const row=history[i];if(row.key===physicalKey&&row.kind===s.kind&&row.tick===time&&row.x===x&&row.y===y){shared=row.envelope;break;}}
    const physical=reusable?old.envelope:shared;
    const envelope=physical?{...physical,revision:geometryKey(s)}:formationEnvelope(s,tick);
    if(reusable)this.telemetry.metadataReuses++;
    else if(shared)this.telemetry.projectedReuses++;
    else {
      this.telemetry.envelopeBuilds++;
      if(!history){history=[];if(this.envelopeHistory.size>=2048)this.envelopeHistory.delete(this.envelopeHistory.keys().next().value!);this.envelopeHistory.set(s.id,history);}
      if(history.length>=8)history.shift();history.push({key:physicalKey,kind:s.kind,tick:time,x,y,envelope});
    }
    this.envelopes.set(s,{troops:s.troops,definition:s.definitionId,kind:s.kind,formation:s.formation,
      capacity:s.manpower?.capacity,variant:s.manpower?.variant,charge:s.charge?.phase,tick:time,envelope,physicalKey});
    return envelope;
  }
  body(s:Squad,tick:number):PreparedFormationBody {
    const pose=this.pose(s,tick);
    if(!pose.body){this.telemetry.bodyBuilds++;pose.body=new PreparedFormationBody(s,tick,pose.envelope);}
    return pose.body;
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
