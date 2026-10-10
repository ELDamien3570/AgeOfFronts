import type { GameMap } from "../core/game/GameMap";
import type { LandPaths,WaterPaths } from "./Pathfinding";

/** Lazy static topology: eight short straight probes per shoreline tile.
 * Ownership, combat safety and transport admission remain live decisions. */
export class RiverCrossings {
  private readonly cache=new Map<number,readonly number[]>();
  constructor(private readonly map:GameMap,private readonly land:LandPaths,private readonly water:WaterPaths) {}
  destinations(origin:number):readonly number[] {
    const saved=this.cache.get(origin);if(saved)return saved;
    const result:number[]=[];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      for(let distance=1;distance<=9;distance++) {
        const x=this.map.x(origin)+dx*distance,y=this.map.y(origin)+dy*distance;
        if(!this.map.isValidCoord(x,y))break;
        const tile=this.map.ref(x,y);
        if(this.land.walkable(tile)) {if(distance>1)result.push(tile);break;}
        if(!this.water.walkable(tile))break;
      }
    }
    const rows=[...new Set(result)].sort((a,b)=>a-b);
    if(this.cache.size>=4096)this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(origin,rows);return rows;
  }
}
