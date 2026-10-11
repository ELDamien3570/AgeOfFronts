import type {Squad} from './Protocol';
import {FIXED} from './Protocol';
import {SpatialGrid} from './SpatialGrid';
import {formationEnvelope,geometryKey} from './domain/FormationGeometry';
interface Entry {id:number;playerId:number;x:number;y:number;radius:number;geometry:string}
/** Live landing broad phase. Stored positions survive owned-record mutation. */
export class LandingOccupancy {
  private readonly entries=new Map<number,Entry>();
  private readonly grid:SpatialGrid<Entry>;
  constructor(width:number,height:number,private readonly tick:()=>number,squads:readonly Squad[]){
    this.grid=new SpatialGrid(width*FIXED,height*FIXED,4*FIXED,e=>e.playerId,e=>e.radius);
    for(const s of squads)this.observe(s);
  }
  observe(s:Squad):void {
    if(s.embarkedOn!==null || s.afloat){this.remove(s.id);return;}
    const geometry=`${geometryKey(s)}:${s.formation?.transition?this.tick():0}`,old=this.entries.get(s.id);
    if(old && old.x===s.x && old.y===s.y && old.playerId===s.playerId && old.geometry===geometry)return;
    this.remove(s.id);
    const entry={id:s.id,playerId:s.playerId,x:s.x,y:s.y,radius:formationEnvelope(s,this.tick()).broadRadius,geometry};
    this.entries.set(s.id,entry);this.grid.insert(entry);
  }
  remove(id:number):void {const old=this.entries.get(id);if(old){this.grid.remove(old);this.entries.delete(id);}}
  query(s:Squad):readonly Entry[] {
    const result:Entry[]=[];this.grid.queryOverlaps(s.x,s.y,formationEnvelope(s,this.tick()).broadRadius,result,s.playerId);return result;
  }
}
