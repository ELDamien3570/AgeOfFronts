import type { GameMap } from "../core/game/GameMap";
import { FIXED, type Squad } from "./Protocol";
import { tilePoint } from "./SquadGeometry";
import type { WorldPoint } from "./SpatialGrid";

export type FormationReservation = Pick<Squad, "id" | "kind" | "playerId"> & WorldPoint;
export function formationBucket(point: WorldPoint): string {
  return `${Math.floor(point.x / (4 * FIXED))}:${Math.floor(point.y / (4 * FIXED))}`;
}
/** One live occupancy view per planning batch, shared by all continuations.
 * Derived state is rebuilt after restore; it is never a checkpoint dependency. */
export class FormationOccupancy {
  readonly buckets = new Map<string, FormationReservation[]>();
  private readonly points = new Map<number, FormationReservation[]>();
  constructor(private readonly map: GameMap) {}
  rebuild(squads: readonly Squad[]): void {
    this.buckets.clear();
    this.points.clear();
    for (const squad of squads) this.refresh(squad);
  }
  refresh(squad: Squad): void {
    for (const point of this.points.get(squad.id) ?? []) {
      const key = formationBucket(point), bucket = this.buckets.get(key)!;
      bucket.splice(bucket.indexOf(point), 1);
      if (!bucket.length) this.buckets.delete(key);
    }
    const points: FormationReservation[] = [];
    if (squad.embarkedOn === null) {
      points.push({id:squad.id,kind:squad.kind,playerId:squad.playerId,x:squad.x,y:squad.y});
      for (const order of [squad.order, ...squad.queuedOrders]) {
        if (order.type !== "move") continue;
        points.push({id:squad.id,kind:squad.kind,playerId:squad.playerId,
          ...(order.x === undefined ? tilePoint(this.map,order.tile) : {x:order.x,y:order.y!})});
      }
    }
    this.points.set(squad.id, points);
    for (const point of points) {
      const key = formationBucket(point), bucket = this.buckets.get(key);
      if (bucket) bucket.push(point);
      else this.buckets.set(key,[point]);
    }
  }
}
