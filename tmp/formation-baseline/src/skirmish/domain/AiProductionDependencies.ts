import { producerCompatible } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { Inventory, ProductionRecipe } from "./Definitions";
export type AiBottleneckReason="workshop"|"research"|"resource"|"incoming"|"protected"|"capacity"|"unaffordable"|"limited"|"cycle";
export interface AiDependencyQuote {
 phase:"discover"|"parents"|"expand"|"done";wanted:Inventory;materials:Inventory;
 nodes:Map<string,{recipeId?:string;inputs:string[];parents:number;processed:boolean}>;queue:string[];cursor:number;edge:number;
 reasons:{item:string;reason:AiBottleneckReason}[];ticks:number;work:number;status:AiDependencyAvailability;
}
export type AiDependencyAvailability = "available" | "unavailable" | "deferred";

/** Bounded researched dependency quotes. A missing workshop is an investment
 * prerequisite; it does not make attainable ore into an impossible equipment
 * chain. This quote grants neither goods nor purchasing credit.
 */
export class AiProductionDependencies {
  private readonly recipes: ProductionRecipe[];
  private readonly byOutput=new Map<string,ProductionRecipe[]>();
  private readonly readyTypes=new Set<import("../Protocol").BuildingType>();
  lastQuote?:AiDependencyQuote;
  deferred = false;
  constructor(
    private readonly snapshot: AiEconomicSnapshot,
    private readonly renewable: ReadonlySet<string>,
    private readonly protectedStock:Readonly<Inventory>={},
  ) {
    for(const b of snapshot.buildings)if(!b.remainingTicks && (b.health??1)>0)this.readyTypes.add(b.type);
    this.recipes = PRODUCTION_RECIPES.filter((r) =>
      snapshot.research.includes(r.technologyId),
    ).sort(
      (a, b) =>
        Number(this.producer(b)) - Number(this.producer(a)) ||
        a.ticks - b.ticks ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for(const recipe of this.recipes)for(const id of Object.keys(recipe.outputs)){const rows=this.byOutput.get(id)??[];rows.push(recipe);this.byOutput.set(id,rows);}
  }
  private producer(recipe: ProductionRecipe): boolean {
    for(const type of this.readyTypes)if(producerCompatible(type,recipe.building))return true;
    return false;
  }
  private held(id: string): number {
    return (
      Math.max(0,(this.snapshot.liquid.items?.[id] ?? 0)-(this.protectedStock[id]??0)) +
      (this.snapshot.incoming[id] ?? 0)
    );
  }
  available(id: string, amount: number): boolean {
    return this.availability(id, amount) === "available";
  }
  availability(id: string, amount: number): AiDependencyAvailability {
    let nodes = 0;
    const visit = (
      item: string,
      count: number,
      depth: number,
      seen: ReadonlySet<string>,
    ): AiDependencyAvailability => {
      if (++nodes > 32) return "deferred";
      if (this.held(item) >= count || this.renewable.has(item))
        return "available";
      if (seen.has(item)) return "unavailable";
      const recipes = this.byOutput.get(item)??[];
      if (!recipes.length) return "unavailable";
      if (depth >= 3) return "deferred";
      const next = new Set(seen);
      next.add(item);
      let unknown = recipes.length > 4;
      for (const recipe of recipes.slice(0, 4)) {
        const batches = Math.ceil(
          Math.max(0, count - this.held(item)) / recipe.outputs[item],
        );
        let blocked = false,
          deferred = false;
        for (const [input, n] of Object.entries(recipe.inputs)) {
          const status = visit(input, n * batches, depth + 1, next);
          if (status === "unavailable") {
            blocked = true;
            break;
          }
          deferred ||= status === "deferred";
        }
        if (!blocked && !deferred) return "available";
        unknown ||= !blocked && deferred;
      }
      return unknown ? "deferred" : "unavailable";
    };
    const status = visit(id, amount, 0, new Set());
    this.deferred ||= status === "deferred";
    return status;
  }
  beginMaterials(equipment:Readonly<Inventory>):AiDependencyQuote {
    return {phase:"discover",wanted:{...equipment},materials:{},nodes:new Map(),queue:Object.keys(equipment).sort(),cursor:0,edge:0,reasons:[],ticks:0,work:0,status:"available"};
  }
  stepMaterials(quote:AiDependencyQuote,budget:number):number{
    if(!Number.isInteger(budget)||budget<0)throw new Error("Invalid dependency allowance");
    let used=0;
    while(used<budget && quote.phase!=="done"){
      used++;quote.work++;
      if(quote.phase==="discover"){
        const id=quote.queue[quote.cursor++];
        if(id===undefined){quote.phase="parents";quote.queue=[...quote.nodes.keys()].sort();quote.cursor=0;quote.edge=0;continue;}
        if(quote.nodes.has(id))continue;
        if(quote.nodes.size>=32){quote.status="deferred";quote.reasons.push({item:id,reason:"limited"});quote.phase="done";this.deferred=true;continue;}
        const recipe=(this.byOutput.get(id)??[]).slice(0,4).find(r=>Object.entries(r.inputs).every(([input,n])=>this.available(input,n)));
        const inputs=recipe?Object.keys(recipe.inputs).sort():[];
        quote.nodes.set(id,{recipeId:recipe?.id,inputs,parents:0,processed:false});
        if(recipe && !this.producer(recipe))quote.reasons.push({item:id,reason:"workshop"});
        if(!recipe && this.held(id)<(quote.wanted[id]??0) && !this.renewable.has(id)){
          const authored=PRODUCTION_RECIPES.some(r=>r.outputs[id]);
          const researched=(this.byOutput.get(id)?.length??0)>0;
          quote.reasons.push({item:id,reason:authored&&!researched?"research":"resource"});quote.status=this.deferred?"deferred":"unavailable";
        }
        if((this.snapshot.incoming[id]??0)>0)quote.reasons.push({item:id,reason:"incoming"});
        if((this.protectedStock[id]??0)>0)quote.reasons.push({item:id,reason:"protected"});
        for(const input of inputs)if(!quote.nodes.has(input) && !quote.queue.includes(input))quote.queue.push(input);
      }else if(quote.phase==="parents"){
        const id=quote.queue[quote.cursor],node=id===undefined?undefined:quote.nodes.get(id);
        if(!node){quote.phase="expand";quote.queue=[...quote.nodes.keys()].filter(id=>!quote.nodes.get(id)!.parents).sort();quote.cursor=0;continue;}
        const input=node.inputs[quote.edge++];
        if(input===undefined){quote.cursor++;quote.edge=0;}else {const child=quote.nodes.get(input);if(child)child.parents++;}
      }else{
        const id=quote.queue[quote.cursor++];
        if(id===undefined){
          if([...quote.nodes.values()].some(n=>!n.processed)){quote.status="unavailable";quote.reasons.push({item:"chain",reason:"cycle"});}
          quote.phase="done";continue;
        }
        const node=quote.nodes.get(id)!;node.processed=true;
        const recipe=node.recipeId?this.recipes.find(r=>r.id===node.recipeId):undefined;
        if(recipe){
          const batches=Math.ceil(Math.max(0,(quote.wanted[id]??0)-this.held(id))/recipe.outputs[id]);
          quote.ticks+=batches*recipe.ticks;
          for(const input of node.inputs){
            const quantity=recipe.inputs[input]*batches;
            quote.wanted[input]=(quote.wanted[input]??0)+quantity;quote.materials[input]=(quote.materials[input]??0)+quantity;
            const child=quote.nodes.get(input)!;if(--child.parents===0)quote.queue.push(input);
          }
        }
      }
    }
    return used;
  }
  materials(equipment: Readonly<Inventory>): Inventory {
    const quote=this.beginMaterials(equipment);
    this.stepMaterials(quote,256);
    this.lastQuote=quote;
    if(quote.phase!=="done" || quote.status==="deferred")this.deferred=true;
    return quote.materials;
  }
}
