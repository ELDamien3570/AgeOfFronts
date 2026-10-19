import { secondsToTicks } from '../Protocol';
import type { Player } from "../Protocol";
import type { Diplomacy } from "./Diplomacy";
import type { AiOperations } from "./AiOperations";

export type PairRelation = "neutral" | "allied" | "war" | "conflict";
export interface PairRelationRow { a:number; b:number; state:Exclude<PairRelation,"neutral"> }
const key = (a:number,b:number) => `${Math.min(a,b)}:${Math.max(a,b)}`;

/** Shared bilateral facts. AI preparation/recovery remain private planning states.
 * Recent aggression is authoritative; lookup tables are disposable projections. */
export class PairRelations {
  private readonly recent = new Map<string,{a:number;b:number;until:number}>();
  // The projection's inputs at the last refresh. Comparing the numbers is the
  // same test as comparing their ":"-joined string; `dirty` forces a refresh.
  private readonly stamp = [NaN, NaN, NaN, NaN, NaN, NaN];
  private dirty = true;
  private rows: PairRelationRow[] = [];
  private readonly pairs = new Map<string,PairRelation>();
  private content = "";
  private projectionRevision=0;
  private readonly ownerSignatures=new Map<number,string>();
  constructor(private readonly world:{tick:number;players:Player[]},
    private readonly diplomacy:Diplomacy,private readonly operations:AiOperations) {}
  checkpoint() { return structuredClone([...this.recent]); }
  restore(saved?:ReturnType<PairRelations["checkpoint"]>):void {
    this.recent.clear();for(const [k,row] of saved??[])this.recent.set(k,structuredClone(row));this.dirty=true;
  }
  threatened(a:number,b:number):void {
    if(!this.diplomacy.hostile(a,b))return;
    this.recent.set(key(a,b),{a:Math.min(a,b),b:Math.max(a,b),until:this.world.tick+secondsToTicks(30)});
    this.dirty=true;
  }
  private refresh():void {
    const {world,diplomacy,operations}=this;
    const stamp=this.stamp,wars=diplomacy.state.wars?.length??0;
    if(!this.dirty && stamp[0]===world.tick && stamp[1]===diplomacy.revision && stamp[2]===operations.revision &&
      stamp[3]===operations.permissionRevision && stamp[4]===diplomacy.state.alliances.length && stamp[5]===wars)return;
    this.dirty=false;
    stamp[0]=world.tick;stamp[1]=diplomacy.revision;stamp[2]=operations.revision;
    stamp[3]=operations.permissionRevision;stamp[4]=diplomacy.state.alliances.length;stamp[5]=wars;
    this.pairs.clear();
    const live=new Set(world.players.filter(p=>!p.eliminated).map(p=>p.id));
    const set=(a:number,b:number,state:PairRelation)=>{
      if(a!==b && live.has(a) && live.has(b))this.pairs.set(key(a,b),state);
    };
    if(diplomacy.raids){
      for(const w of diplomacy.state.embargoes??[])if(diplomacy.embargo(w.initiator,w.victim))set(w.initiator,w.victim,"conflict");
      for(const w of diplomacy.state.wars??[])set(w.a,w.b,"war");
    } else {
      for(const w of diplomacy.state.wars??[])set(w.a,w.b,"war");
      for(const w of operations.activeConflicts())set(w.a,w.b,"conflict");
      for(const w of this.recent.values())if(w.until>=world.tick)set(w.a,w.b,"conflict");
    }
    for(const t of diplomacy.state.alliances)set(t.a,t.b,"allied");
    this.rows=[...this.pairs].map(([k,state])=>{
      const [a,b]=k.split(":").map(Number);return {a,b,state:state as PairRelationRow["state"]};
    }).sort((x,y)=>x.a-y.a||x.b-y.b);
    const content=this.rows.map(r=>`${r.a}:${r.b}:${r.state}`).join(",");
    // Owner signatures are a function of the rows, which content encodes.
    if(content===this.content)return;
    this.projectionRevision++;
    this.content=content;
    this.ownerSignatures.clear();
    for(const r of this.rows)for(const id of [r.a,r.b])this.ownerSignatures.set(id,
      (this.ownerSignatures.get(id)??"")+`${r.a}:${r.b}:${r.state},`);
  }
  state(a:number,b:number):PairRelation {
    if(a===b)return "allied";this.refresh();return this.pairs.get(key(a,b))??"neutral";
  }
  atWar(a:number,b:number):boolean { const s=this.state(a,b);return s==="war"||s==="conflict"; }
  get signature():string {this.refresh();return this.content;}
  get revision():number {this.refresh();return this.projectionRevision;}
  signatureFor(owner:number):string {
    this.refresh();return this.ownerSignatures.get(owner)??"";
  }
  snapshot():PairRelationRow[] {this.dirty=true;this.refresh();return this.rows;}
}
