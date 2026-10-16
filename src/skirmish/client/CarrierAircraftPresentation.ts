import { FIXED,TICKS_PER_SECOND,type Snapshot } from '../Protocol';
import { shipSpriteSize } from './MapSymbols';
import type { BoatPose } from './BoatPresentation';
import type { Aircraft } from '../domain/Definitions';
type Pose={x:number;y:number;angle:number;size:number;radius:number;elevation?:number};
/** Deck berths follow the rendered ship pose. No aircraft positions or orders are mutated. */
export class CarrierAircraftPresentation {
  private snapshot?:Snapshot;
  private readonly aircraft=new Map<number,Aircraft>();
  private readonly carriers=new Map<number,Snapshot['ships'][number]>();
  private readonly states=new Map<number,{baseId:number;slot:number;ready:boolean;departed?:number}>();
  reset(){this.snapshot=undefined;this.states.clear();this.aircraft.clear();this.carriers.clear();}
  update(snapshot:Snapshot):void {
    this.snapshot=snapshot;
    const carriers=new Set(snapshot.ships.filter(s=>s.kind==='carrier').map(s=>s.id));
    const aircraft=snapshot.expansion?.aircraft??[];
    this.aircraft.clear();this.carriers.clear();
    for(const a of aircraft)if(a.definitionId!=='drone')this.aircraft.set(a.id,a);
    for(const s of snapshot.ships)if(s.kind==='carrier'&&s.health>0)this.carriers.set(s.id,s);
    const live=new Set(aircraft.map(a=>a.id));
    for(const id of this.states.keys())if(!live.has(id))this.states.delete(id);
    const slots=new Map<number,Set<number>>();
    for(const a of aircraft) {
      if(!carriers.has(a.airfieldId) || a.definitionId==='drone')continue;
      let occupied=slots.get(a.airfieldId);if(!occupied)slots.set(a.airfieldId,occupied=new Set());
      const old=this.states.get(a.id);
      let slot=old?.baseId===a.airfieldId?old.slot:0;while(occupied.has(slot))slot++;
      occupied.add(slot);
      this.states.set(a.id,{baseId:a.airfieldId,slot,ready:a.state==='ready',departed:old?.ready&&a.state!=='ready'?snapshot.tick:a.state==='ready'?undefined:old?.departed});
    }
  }
  pose(id:number,flight:Pose,scale:number,blend:number,boat:(id:number)=>BoatPose|undefined):Pose|undefined {
    const snapshot=this.snapshot,aircraft=this.aircraft.get(id);
    if(!snapshot||!aircraft)return;
    const state=this.states.get(id);
    const arrivalId=aircraft.transfer?.destinationId??aircraft.airfieldId;
    const landing=this.carriers.get(arrivalId);
    const source=this.carriers.get(aircraft.airfieldId);
    const arriving=(aircraft.state==='returning'||aircraft.state==='transferring')&&landing;
    const carrier=arriving?landing:source;if(!carrier)return;
    const shipPose=boat(carrier.id)??{...carrier,angle:0,moving:false};
    const extent=shipSpriteSize(scale,'carrier')/scale*FIXED,angle=shipPose.angle;
    const deckPoint=(x:number,y:number)=>({x:shipPose.x+(x*Math.cos(angle)-y*Math.sin(angle))*extent,y:shipPose.y+(x*Math.sin(angle)+y*Math.cos(angle))*extent});
    const parked=deckPoint(-.055,-.25+(state?.slot??0)*.1),bow=deckPoint(0,-.37),size=shipSpriteSize(scale,'carrier')*.085;
    if(aircraft.state==='ready')return {...parked,size,angle,radius:Math.max(4,size*.71+2),elevation:0};
    const departed=state?.departed;
    let t=1;
    if(departed!==undefined)t=Math.max(0,Math.min(1,(snapshot.tick-1+blend-departed)/(TICKS_PER_SECOND*.65)));
    if(arriving)t=Math.max(0,Math.min(1,Math.hypot(flight.x-bow.x,flight.y-bow.y)/(3*FIXED)));
    if(t>=1)return;
    const ground=arriving?bow:parked;
    const smooth=t*t*(3-2*t);
    return {x:ground.x+(flight.x-ground.x)*smooth,y:ground.y+(flight.y-ground.y)*smooth,size:size+(flight.size-size)*smooth,
      angle:angle+Math.atan2(Math.sin(flight.angle-angle),Math.cos(flight.angle-angle))*smooth,radius:flight.radius,elevation:smooth};
  }
}
