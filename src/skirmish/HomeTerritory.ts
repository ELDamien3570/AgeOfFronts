import { restoreMap } from "./StateTransfer";
import type { GameMap } from "../core/game/GameMap";

interface HomeFrontier {
  tick: number;
  baseOwned: boolean;
  tiles: number[];
  shores?: number[];
  anchors?: string;
}

// Expansion starts at the home camp and occupied, registered bridgeheads.
// Arbitrary disconnected captures do not seed exploration on their own.
export class HomeTerritory {
  checkpoint() { return structuredClone({cache:this.cache,failures:this.failures,cursors:this.cursors,crossings:this.crossings,bridgeheads:this.bridgeheads,shoreCursors:this.shoreCursors}); }
  restore(saved: ReturnType<HomeTerritory["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreMap(this.cache,state.cache);
    restoreMap(this.failures,state.failures??new Map());
    restoreMap(this.cursors,state.cursors??new Map());
    restoreMap(this.crossings,state.crossings??new Map());
    restoreMap(this.bridgeheads,state.bridgeheads??new Map());
    restoreMap(this.shoreCursors,state.shoreCursors??new Map());
    this.visited.fill(0); this.stamp=0;
  }

  private readonly visited: Uint32Array;
  private stamp = 0;
  private readonly cache = new Map<number, HomeFrontier>();
  private readonly failures = new Map<string,number>();
  private readonly cursors = new Map<number,number>();
  private readonly crossings = new Map<number,number>();
  private readonly bridgeheads=new Map<number,Map<number,number>>();
  private readonly shoreCursors=new Map<number,number>();
  sampleShores(playerId:number):number[] {
    const rows=this.shores(playerId),start=this.shoreCursors.get(playerId)??0,count=Math.min(32,rows.length);
    this.shoreCursors.set(playerId,rows.length?(start+count)%rows.length:0);
    return Array.from({length:count},(_,i)=>rows[(start+i)%rows.length]);
  }
  anchor(playerId:number,component:number,tile:number,owners:Uint8Array):void {
    const rows=this.bridgeheads.get(playerId)??new Map<number,number>();
    const previous=rows.get(component);
    if(previous===undefined || owners[previous]!==playerId)rows.set(component,tile);
    this.bridgeheads.set(playerId,rows);
  }
  anchors(playerId:number,owners:Uint8Array):number[] {return [...(this.bridgeheads.get(playerId)?.values()??[])].filter(t=>owners[t]===playerId);}
  failed(playerId:number,tile:number,tick:number):void {
    this.failures.set(`${playerId}:${tile}`,tick+600);
    while(this.failures.size>2048)this.failures.delete(this.failures.keys().next().value!);
  }
  available(playerId:number,tile:number,tick:number):boolean {return (this.failures.get(`${playerId}:${tile}`)??0)<=tick;}
  crossingReady(playerId:number,tick:number):boolean {return tick>=(this.crossings.get(playerId)??0);}
  crossed(playerId:number,tick:number,delay=600):void {this.crossings.set(playerId,tick+delay);}
  shores(playerId:number):readonly number[] {return this.cache.get(playerId)?.shores??[];}
  constructor(private readonly map: GameMap) {
    this.visited = new Uint32Array(map.width() * map.height());
  }
  frontier(
    playerId: number,
    base: number,
    owners: Uint8Array,
    tick: number,
    anchors:readonly number[] = [],
  ): readonly number[] {
    const previous = this.cache.get(playerId),
      baseOwned = owners[base] === playerId,
      anchorKey=[...new Set(anchors.filter(t=>owners[t]===playerId))].sort((a,b)=>a-b).join(",");
    if (
      previous &&
      previous.baseOwned === baseOwned &&
      (previous.anchors??"")===anchorKey &&
      tick - previous.tick < 60
    )
      return previous.tiles;
    if (++this.stamp === 0xffffffff) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    const queue = [...new Set([...(baseOwned?[base]:[]),...anchors.filter(t=>owners[t]===playerId)])],
      frontier: number[] = [], shores:number[]=[];
    for(const tile of queue)this.visited[tile]=this.stamp;
    this.visited[base] = this.stamp;
    for (let at = 0; at < queue.length; at++)
      for (const tile of this.map.neighbors(queue[at])) {
        if (this.visited[tile] === this.stamp) continue;
        this.visited[tile] = this.stamp;
        if (!this.map.isLand(tile)) {shores.push(queue[at]);continue;}
        if (this.map.isImpassable(tile)) continue;
        if (owners[tile] === playerId) queue.push(tile);
        else frontier.push(tile);
      }
    frontier.sort(
      (a, b) =>
        this.map.euclideanDistSquared(base, a) -
          this.map.euclideanDistSquared(base, b) || a - b,
    );
    this.cache.set(playerId, { tick, baseOwned, tiles: frontier,shores:[...new Set(shores)],anchors:anchorKey });
    return frontier;
  }
  goal(
    playerId: number,
    base: number,
    current: number,
    owners: Uint8Array,
    frontier: readonly number[],
    reserved: Set<number>,
    eligible: (tile: number) => boolean = () => true,
  ): number | undefined {
    let goal: number | undefined,
      best = Infinity,
      considered = 0;
    const start=this.cursors.get(playerId)??0,tick=this.cache.get(playerId)?.tick??0;
    for(let at=0;at<Math.min(128,frontier.length);at++) {
      const tile=frontier[(start+at)%frontier.length];considered++;
      if (owners[tile] === playerId || reserved.has(tile) || !eligible(tile) ||
        !this.available(playerId,tile,tick)) continue;
      // Neutral ground is preferred; nearby enemy pockets are still eligible.
      const score =
        this.map.euclideanDistSquared(base, tile) * 2 +
        this.map.euclideanDistSquared(current, tile) * 0.25 +
        (owners[tile] ? 32 : 0);
      if (score < best) {
        best = score;
        goal = tile;
      }
    }
    this.cursors.set(playerId,frontier.length?(start+considered)%frontier.length:0);
    if (goal !== undefined) reserved.add(goal);
    return goal;
  }
}
