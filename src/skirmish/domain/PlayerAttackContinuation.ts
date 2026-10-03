import { FIXED, type Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { distanceSquared } from "../SquadGeometry";

interface Pursuit {
  anchor: WorldPoint;
  nextScan: number;
  missingSince?: number;
  failed: Map<number, { until: number; tile: number }>;
  progress?: WorldPoint & {tick:number};
}

/** Player attack intent survives a lost target, but never an explicit Hold.
 * Candidate scans are staggered and local; exact routes use the normal queue.
 * Failed targets are suppressed briefly, rather than retried every ten ticks.
 */
export class PlayerAttackContinuation {
  private readonly pursuits=new Map<number,Pursuit>();
  private scansThisTick=0;
  beginTick():void{this.scansThisTick=0;}
  readonly diagnostics={scans:0,candidates:0,retargets:0,unreachable:0};
  observe(squad:Squad,target:Squad|undefined):void {
    if(squad.order.type!=="attack"){this.pursuits.delete(squad.id);return;}
    this.pursuits.set(squad.id,{anchor:{x:target?.x??squad.x,y:target?.y??squad.y},nextScan:0,failed:new Map()});
  }
  failed(squad:Squad,target:Squad,tick:number,tile:number):void {
    const state=this.pursuits.get(squad.id);if(!state)return;
    state.failed.set(target.id,{until:tick+60,tile});state.nextScan=tick;
    this.diagnostics.unreachable++;
  }
  blocked(squad:Squad,target:Squad,tick:number,tile:number):boolean {
    const failure=this.pursuits.get(squad.id)?.failed.get(target.id);
    return !!failure&&failure.until>tick&&failure.tile===tile;
  }
  outside(squad:Squad,target:Squad):boolean {
    const state=this.pursuits.get(squad.id);
    return !!state&&distanceSquared(state.anchor,target)>(16*FIXED)**2;
  }
  stagnant(squad:Squad,tick:number):boolean {
    const state=this.pursuits.get(squad.id);if(!state)return false;
    if(!state.progress||distanceSquared(squad,state.progress)>(FIXED/4)**2)state.progress={x:squad.x,y:squad.y,tick};
    return tick-state.progress.tick>=40;
  }
  choose(squad:Squad,tick:number,nearby:()=>readonly Squad[],eligible:(target:Squad)=>boolean,tileOf:(target:Squad)=>number,lost=true):Squad|undefined {
    let state=this.pursuits.get(squad.id);
    if(!state){this.observe(squad,undefined);state=this.pursuits.get(squad.id)!;}
    if(lost)state.missingSince??=tick;
    if(tick<state.nextScan||this.scansThisTick>=32)return;
    this.scansThisTick++;
    state.nextScan=tick+10;this.diagnostics.scans++;
    for(const [id,failure] of state.failed)if(failure.until<=tick)state.failed.delete(id);
    let best:Squad|undefined,bestDistance=Infinity;
    for(const target of nearby()){
      this.diagnostics.candidates++;
      const distance=distanceSquared(squad,target);
      if(distance>(12*FIXED)**2||distanceSquared(state.anchor,target)>(16*FIXED)**2||
        this.blocked(squad,target,tick,tileOf(target))||!eligible(target))continue;
      if(distance<bestDistance||(distance===bestDistance&&target.id<(best?.id??Infinity))){best=target;bestDistance=distance;}
    }
    if(best){state.missingSince=undefined;state.progress={x:squad.x,y:squad.y,tick};this.diagnostics.retargets++;}
    return best;
  }
  expired(squad:Squad,tick:number):boolean {
    const since=this.pursuits.get(squad.id)?.missingSince;
    return since!==undefined&&tick-since>=60;
  }
  forget(id:number):void{this.pursuits.delete(id);}
  checkpoint(){return structuredClone([...this.pursuits]);}
  restore(saved?:ReturnType<PlayerAttackContinuation["checkpoint"]>):void {
    this.pursuits.clear();for(const [id,state] of structuredClone(saved??[]))this.pursuits.set(id,state);
  }
}
