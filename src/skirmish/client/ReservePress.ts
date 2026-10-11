import type { SoldierSlot } from './FormationSoldierMotion';

type Point={x:number;y:number};
type Edge=0|1|2|3;
const directions:readonly Point[]=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
interface Assignment {edge:Edge;depth:number;pitch:number}
export interface ReserveStep extends Point {moving:boolean;angle?:number}

/** Cosmetic support bands. Plans use four formation edges, not soldier paths
 * or neighbor searches. Following an edge preserves each reserve's own file. */
export class ReservePress {
  private key='';
  private readonly assignments=new Map<number,Assignment>();
  private readonly offsets=new Map<number,Point>();
  private pitches:readonly number[]=[1,1];
  constructor(private readonly variant=0) {}

  rebaseFrame(angle:number):void {
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const [id,p] of this.offsets)this.offsets.set(id,{x:p.x*c-p.y*s,y:p.x*s+p.y*c});
    // Recompile edge roles in the new basis while retaining current displacement.
    this.key='';this.assignments.clear();
  }

  sample(dt:number,slots:readonly SoldierSlot[],sectors:readonly number[],front:ReadonlySet<number>,
    frontOffsets:ReadonlyMap<number,Point>,options:{enabled:boolean;square:boolean;layout?:string;limit?:number;crowd?:boolean}):Map<number,ReserveStep> {
    const result=new Map<number,ReserveStep>();
    if(!slots.length){this.assignments.clear();this.offsets.clear();this.key='';return result;}
    const edges=[...new Set(sectors.flatMap(sector=>{
      const x=Math.cos(sector*Math.PI/4),y=Math.sin(sector*Math.PI/4),edges:Edge[]=[];
      if(Math.abs(x)>.38)edges.push(x>0?0:2);
      if(Math.abs(y)>.38)edges.push(y>0?1:3);
      return edges;
    }))].sort();
    const xs=slots.map(p=>p.x),ys=slots.map(p=>p.y);
    const bounds=[Math.max(...xs),Math.max(...ys),-Math.min(...xs),-Math.min(...ys)];
    const scale=Math.max(...slots.map(p=>p.scale));
    const pitch=(values:number[])=>{
      const sorted=[...values].sort((a,b)=>a-b);
      let best=Infinity;
      for(let i=1;i<sorted.length;i++){const d=sorted[i]-sorted[i-1];if(d>scale*.2)best=Math.min(best,d);}
      return Number.isFinite(best)?best:scale;
    };
    const key=options.enabled?`active:${!!options.crowd}:${edges}:${bounds.map(n=>Math.round(n/(scale*.2)))}:${slots.map(p=>p.id)}`:`inactive:${slots.map(p=>p.id)}`;
    if(key!==this.key){
      this.key=key;
      if(options.enabled)this.pitches=[pitch(xs),pitch(ys)];
      const pitches=this.pitches;
      const old=new Map(this.assignments);this.assignments.clear();
      if(options.enabled)for(const slot of slots){
        if(front.has(slot.id))continue;
        const distance=(edge:Edge)=>bounds[edge]-slot.x*directions[edge].x-slot.y*directions[edge].y;
        let edge=edges.reduce<Edge|undefined>((best,e)=>best===undefined||distance(e)<distance(best)?e:best,undefined);
        if(edge===undefined)continue;
        const previous=old.get(slot.id);
        if(previous && edges.includes(previous.edge) && distance(previous.edge)<=distance(edge)+pitches[previous.edge%2]*.35)edge=previous.edge;
        const spacing=pitches[edge%2],depth=Math.max(1,Math.round(distance(edge)/spacing));
        if(options.crowd||depth<=3)this.assignments.set(slot.id,{edge,depth,pitch:spacing});
      }
    }
    // Previous-frame front displacement is shared by a whole support band.
    // The feedback is outward only: reserves never drag the fighting edge.
    const advance=[0,0,0,0],lateral=[0,0,0,0],counts=[0,0,0,0];
    for(const slot of slots){
      if(!front.has(slot.id))continue;
      const offset=frontOffsets.get(slot.id);if(!offset)continue;
      for(const edge of edges){const n=directions[edge];
        if(bounds[edge]-slot.x*n.x-slot.y*n.y>slot.scale*.22)continue;
        advance[edge]+=Math.max(0,offset.x*n.x+offset.y*n.y);counts[edge]++;
        lateral[edge]+=offset.x*-n.y+offset.y*n.x;
      }
    }
    for(const edge of edges)if(counts[edge]){advance[edge]/=counts[edge];lateral[edge]/=counts[edge];}
    const stiffness=options.square ? .25 : options.layout==='shield-wall' ? .45 : 1;
    const live=new Set(slots.map(p=>p.id));
    for(const id of this.offsets.keys())if(!live.has(id))this.offsets.delete(id);
    for(const slot of slots){
      const assignment=options.enabled&&!front.has(slot.id)?this.assignments.get(slot.id):undefined;
      let goal:Point={x:0,y:0},angle:number|undefined;
      if(assignment){
        const {edge,depth,pitch}=assignment,n=directions[edge];
        const follow=options.crowd ? .95 : [0,.75,.45,.2][depth];
        const distance=Math.min(options.limit??pitch*.8,stiffness*(advance[edge]*follow+pitch*(options.crowd ? .22*depth : .18/depth)));
        const side=options.crowd?stiffness*Math.max(-pitch*.25,Math.min(pitch*.25,lateral[edge]*.65)):0;
        goal={x:n.x*distance-n.y*side,y:n.y*distance+n.x*side};
        const length=Math.hypot(goal.x,goal.y),limit=options.limit??pitch*.8;
        if(length>limit){goal.x*=limit/length;goal.y*=limit/length;}
        angle=Math.atan2(n.y,n.x)-Math.PI/2;
      }
      const previous=this.offsets.get(slot.id)??{x:0,y:0};
      // Rank-dependent response lets the support press propagate backward.
      const response=assignment?2.8/(1+assignment.depth*.22+((slot.id+this.variant)%3)*.08):4;
      const blend=1-Math.exp(-dt*response);
      let dx=(goal.x-previous.x)*blend,dy=(goal.y-previous.y)*blend;
      const travel=Math.hypot(dx,dy),limit=.45*dt;
      if(options.crowd&&travel>limit){dx*=limit/travel;dy*=limit/travel;}
      const offset={x:previous.x+dx,y:previous.y+dy};
      this.offsets.set(slot.id,offset);
      result.set(slot.id,{...offset,angle,moving:Math.hypot(goal.x-offset.x,goal.y-offset.y)>.001});
    }
    return result;
  }
}
