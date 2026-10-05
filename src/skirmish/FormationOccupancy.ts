import type { GameMap } from "../core/game/GameMap";
import { FIXED, type Squad } from "./Protocol";
import { tilePoint } from "./SquadGeometry";
import type { WorldPoint } from "./SpatialGrid";

export type FormationReservation = Pick<Squad, "id" | "kind" | "playerId"> & WorldPoint;
type MutableReservation = { -readonly [K in keyof FormationReservation]: FormationReservation[K] };
export function formationBucket(point: WorldPoint): string {
  return `${Math.floor(point.x / (4 * FIXED))}:${Math.floor(point.y / (4 * FIXED))}`;
}
/** One live occupancy view per planning batch, shared by all continuations.
 * Derived state is rebuilt after restore; it is never a checkpoint dependency. */
export class FormationOccupancy {
  readonly buckets = new Map<string, FormationReservation[]>();
  private readonly points = new Map<number, MutableReservation[]>();
  private readonly spareBuckets: FormationReservation[][] = [];
  constructor(private readonly map: GameMap) {}
  rebuild(squads: readonly Squad[]): void {
    for(const bucket of this.buckets.values()){bucket.length=0;this.spareBuckets.push(bucket);}
    this.buckets.clear();
    const live=new Set<number>();
    for (const squad of squads) {live.add(squad.id);this.fill(squad);}
    for(const id of this.points.keys())if(!live.has(id))this.points.delete(id);
  }
  refresh(squad: Squad): void {
    for (const point of this.points.get(squad.id) ?? []) {
      const key = formationBucket(point), bucket = this.buckets.get(key)!;
      bucket.splice(bucket.indexOf(point), 1);
      if (!bucket.length) {this.buckets.delete(key);this.spareBuckets.push(bucket);}
    }
    this.fill(squad);
  }
  private fill(squad: Squad): void {
    let points=this.points.get(squad.id);
    if(!points)this.points.set(squad.id,points=[]);
    let count=0;
    const append=(x:number,y:number)=>{
      let point=points![count];
      if(!point)points![count]=point={id:squad.id,kind:squad.kind,playerId:squad.playerId,x,y};
      else {point.kind=squad.kind;point.playerId=squad.playerId;point.x=x;point.y=y;}
      count++;
    };
    if (squad.embarkedOn === null) {
      append(squad.x,squad.y);
      for (const order of [squad.order, ...squad.queuedOrders]) {
        if (order.type !== "move") continue;
        const point=order.x===undefined?tilePoint(this.map,order.tile):{x:order.x,y:order.y!};
        append(point.x,point.y);
      }
    }
    points.length=count;
    for (const point of points) {
      const key = formationBucket(point), bucket = this.buckets.get(key);
      if (bucket) bucket.push(point);
      else {const fresh=this.spareBuckets.pop()??[];fresh.push(point);this.buckets.set(key,fresh);}
    }
  }
}
