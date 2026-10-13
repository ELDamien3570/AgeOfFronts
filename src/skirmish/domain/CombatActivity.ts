import { FIXED, type Squad } from '../Protocol';
import type { UnitQueries } from '../UnitIndex';
import type { CombatGeometry } from './CombatGeometry';
import { cavalryRankExposure } from './CavalryMelee';
interface Body {revision:number;x:number;y:number;radius:number;exposure:number;owner:number;epoch:number}
/** Conservative local wake-up epochs. Changed bodies dirty their old and new
 * envelopes, not merely their root bucket. No camera or time budget participates.
 */
export class CombatActivity {
  private bodies=new Map<number,Body>();
  private epochs:Float64Array;
  private owners:Uint16Array;
  private otherEpochs:Float64Array;
  private epoch=0;
  private columns:number;
  private rows:number;
  constructor(width:number,height:number) {
    this.columns=Math.ceil(width/4);this.rows=Math.ceil(height/4);
    this.epochs=new Float64Array(this.columns*this.rows);
    this.owners=new Uint16Array(this.epochs.length);
    this.otherEpochs=new Float64Array(this.epochs.length);
  }
  private mark(cell:number,owner:number,epoch:number):void {
    // The two latest distinct owners suffice to exclude exactly one faction.
    // This remains fixed-size storage, independent of match history/population.
    if(this.owners[cell]!==owner){this.otherEpochs[cell]=this.epochs[cell];this.owners[cell]=owner;}
    this.epochs[cell]=epoch;
  }
  private cells(x:number,y:number,radius:number,visit:(cell:number)=>void):void {
    const size=4*FIXED,left=Math.max(0,Math.floor((x-radius)/size)),right=Math.min(this.columns-1,Math.floor((x+radius)/size));
    const top=Math.max(0,Math.floor((y-radius)/size)),bottom=Math.min(this.rows-1,Math.floor((y+radius)/size));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)visit(y*this.columns+x);
  }
  update(squads:readonly Squad[],facts:UnitQueries<Squad>,geometry:CombatGeometry,tick:number):void {
    const seen=new Set<number>();
    for(const squad of squads) {
      seen.add(squad.id);const old=this.bodies.get(squad.id),revision=facts.poseRevision(squad.id)!;
      const exposure=cavalryRankExposure(squad.cavalryMelee?.current,tick)|(cavalryRankExposure(squad.cavalryMelee?.previous,tick)<<3);
      if(old?.revision===revision && old.exposure===exposure && !squad.formation?.transition)continue;
      const epoch=++this.epoch;
      const next={revision,exposure,epoch,owner:squad.playerId,x:squad.x,y:squad.y,radius:squad.formation?geometry.envelope(squad,tick).broadRadius:0};
      if(old)this.cells(old.x,old.y,old.radius,i=>this.mark(i,old.owner,epoch));
      this.cells(next.x,next.y,next.radius,i=>this.mark(i,next.owner,epoch));this.bodies.set(squad.id,next);
    }
    for(const [id,old] of this.bodies)if(!seen.has(id)){
      const epoch=++this.epoch;this.cells(old.x,old.y,old.radius,i=>this.mark(i,old.owner,epoch));this.bodies.delete(id);
    }
  }
  region(s:Squad,radius:number,excludeOwner?:number):number {
    let epoch=0;this.cells(s.x,s.y,radius,i=>epoch=Math.max(epoch,
      excludeOwner!==undefined && this.owners[i]===excludeOwner?this.otherEpochs[i]:this.epochs[i]));return epoch;
  }
  pose(id:number):number|undefined {return this.bodies.get(id)?.epoch;}
}
