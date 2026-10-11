import { FIXED, type Squad } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";
import { formationApproach } from "./domain/FormationContact";
import { formationEnvelope } from "./domain/FormationGeometry";
import { meleeContact } from "./SquadGeometry";

export interface ApproachEnvironment {
  revision: string;
  readonly values: number[];
}
const kinds = { infantry: 0, archer: 1, cavalry: 2 };

/** One bounded polar assignment per combat batch, shared by player and AI. */
export class AttackApproaches {
  // Target pressure is consumed by AI before the next movement rebuild; slot
  // assignments persist while their signatures remain valid. Both influence
  // simulation decisions and must survive authoritative checkpoint recovery.
  checkpoint() { return structuredClone({ cache: this.cache, slots: this.slots, loads: this.loads }); }
  restore(saved?: ReturnType<AttackApproaches["checkpoint"]>): void {
    this.cache.clear(); this.slots.clear(); this.loads.clear();
    if (!saved) return;
    const state = structuredClone(saved);
    for (const [key,value] of state.cache) this.cache.set(key,value);
    for (const [key,value] of state.slots) this.slots.set(key,value);
    for (const [key,value] of state.loads) this.loads.set(key,value);
  }
  private readonly cache = new Map<
    string,
    { revision: string; signature: number[]; points: Map<number, WorldPoint> }
  >();
  private readonly signature: number[] = [];
  private readonly environment: ApproachEnvironment = {
    revision: "",
    values: [],
  };
  private readonly slots = new Map<number, WorldPoint>();
  private readonly loads = new Map<string, number>();
  load(playerId: number, targetId: number): number {
    return this.loads.get(`${playerId}:${targetId}`) ?? 0;
  }
  changed(
    playerId: number,
    previous: number | undefined,
    next: number | undefined,
  ): void {
    if (previous !== undefined) {
      const key = `${playerId}:${previous}`;
      this.loads.set(key, Math.max(0, (this.loads.get(key) ?? 0) - 1));
    }
    if (next !== undefined) {
      const key = `${playerId}:${next}`;
      this.loads.set(key, (this.loads.get(key) ?? 0) + 1);
    }
  }
  rebuild(
    squads: readonly Squad[],
    melee: (s: Squad) => boolean,
    valid: (s: Squad, p: WorldPoint) => boolean = () => true,
    environment?: (
      target: Squad,
      owner: number,
      output: ApproachEnvironment,
    ) => void,
    geometry?: {tick:number;reach:(s:Squad)=>number},
  ): void {
    this.slots.clear();
    this.loads.clear();
    for (const s of squads)
      if (s.order.type === "attack" && s.embarkedOn === null && s.troops > 0) {
        const key = `${s.playerId}:${s.order.targetId}`;
        this.loads.set(key, (this.loads.get(key) ?? 0) + 1);
      }
    const targets = new Map(squads.map((s) => [s.id, s]));
    const groups = new Map<string, Squad[]>();
    for (const s of squads)
      if (
        s.order.type === "attack" &&
        s.embarkedOn === null &&
        !s.charge &&
        melee(s)
      ) {
        const key = `${s.playerId}:${s.order.targetId}`,
          row = groups.get(key) ?? [];
        row.push(s);
        groups.set(key, row);
      }
    for (const key of this.cache.keys())
      if (!groups.has(key)) this.cache.delete(key);
    for (const [key, row] of groups) {
      const target = targets.get(
        (row[0].order as { targetId: number }).targetId,
      );
      if (!target || row.length < 2) continue;
      row.sort((a, b) => a.id - b.id);
      const signature = this.signature,
        state = this.environment;
      signature.length = 0;
      if (environment) {
        state.values.length = 0;
        state.revision = "";
        environment(target, row[0].playerId, state);
        signature.push(target.x, target.y, kinds[target.kind], row.length);
        for (const squad of row) signature.push(squad.id, kinds[squad.kind]);
        for (const value of state.values) signature.push(value);
      }
      if(geometry){for(const squad of [target,...row]){const t=squad.formation?.transition, progress=t?Math.min(4,Math.max(0,Math.floor((geometry.tick-t.startTick)*4/t.duration))):0;
        const body=formationEnvelope(squad,t?t.startTick+progress*t.duration/4:geometry.tick);
        signature.push(squad.troops,squad.formation?.revision??0,body.width,body.depth,body.angle,progress);}}
      for(const squad of row)signature.push(Math.round(Math.atan2(squad.y-target.y,squad.x-target.x)*8/Math.PI));
      const cached = this.cache.get(key);
      if (
        environment &&
        cached?.revision === state.revision &&
        cached.signature.length === signature.length &&
        signature.every((value, at) => value === cached.signature[at])
      ) {
        for (const [id, point] of cached.points) this.slots.set(id, point);
        continue;
      }
      const points = new Map<number, WorldPoint>();
      const sectors = 8;
      const bearing=(s:Squad)=>Math.atan2(s.y-target.y,s.x-target.x);
      const mean=Math.atan2(row.reduce((v,s)=>v+Math.sin(bearing(s)),0),row.reduce((v,s)=>v+Math.cos(bearing(s)),0));
      const anchor=Math.round(mean/(Math.PI/8))*Math.PI/8;
      const delta=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
      row.sort((a,b)=>delta(bearing(a)-anchor)-delta(bearing(b)-anchor)||a.id-b.id);
      const rotations:number[]=[];
      for(let start=0;start<row.length;start+=sectors){let best=0,error=Infinity;
        for(let rotation=0;rotation<sectors;rotation++){let score=0;for(let i=0;i<Math.min(sectors,row.length-start);i++)score+=delta(anchor+(i+rotation)*Math.PI*2/sectors-bearing(row[start+i]))**2;
          if(score<error){error=score;best=rotation;}}rotations.push(best);}
      const assigned: WorldPoint[] = [];
      row.forEach((s, i) => {
        // Certify a bounded set of local sectors; occupied sectors use an outer queue.
        // Do not assign positions inside another enemy's body or impassable terrain.
        for (let ring = Math.floor(i/sectors); ring < Math.floor(i/sectors)+4; ring++)
          for (let offset = 0; offset < sectors; offset++) {
            const angle =
              anchor + (((i + rotations[Math.floor(i/sectors)] + (offset%2?Math.ceil(offset/2):-offset/2)) % sectors) * Math.PI * 2) / sectors;
            const radius =
              Math.max(1, meleeContact(s.kind, target.kind) - 4) + ring * FIXED;
            const boundary=geometry && s.formation && target.formation ? formationApproach(s,target,geometry.tick,geometry.reach(s),angle) : undefined;
            const point = {
              x: boundary?Math.round(boundary.x+Math.cos(angle)*ring*FIXED):Math.round(target.x + Math.cos(angle) * radius),
              y: boundary?Math.round(boundary.y+Math.sin(angle)*ring*FIXED):Math.round(target.y + Math.sin(angle) * radius),
            };
            if (
              !valid(s, point) ||
              assigned.some(
                (other) =>
                  (point.x - other.x) ** 2 + (point.y - other.y) ** 2 <
                  (0.75 * FIXED) ** 2,
              )
            )
              continue;
            this.slots.set(s.id, point);
            points.set(s.id, point);
            assigned.push(point);
            return;
          }
      });
      if (environment)
        this.cache.set(key, {
          revision: state.revision,
          signature: signature.slice(),
          points,
        });
    }
  }
  point(squad: Squad): WorldPoint | undefined {
    return this.slots.get(squad.id);
  }
}
