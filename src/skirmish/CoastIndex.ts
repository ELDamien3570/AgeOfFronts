import type { GameMap } from "../core/game/GameMap";
import type { LandPaths, WaterPaths } from "./Pathfinding";

export interface Coast {
  landTile: number;
  waterTile: number;
}

// Static coast edges grouped by both reachable components. Ownership is read
// at query time, so captures never invalidate the topology index.
export class CoastIndex {
  private readonly edges = new Map<string, Coast[]>();
  constructor(map: GameMap, land: LandPaths, water: WaterPaths) {
    for (let tile = 0; tile < land.component.length; tile++) {
      if (!land.walkable(tile)) continue;
      for (const sea of map.neighbors(tile)) {
        if (!water.walkable(sea)) continue;
        const key = `${land.component[tile]}:${water.component[sea]}`;
        let edges = this.edges.get(key);
        if (!edges) this.edges.set(key, (edges = []));
        edges.push({ landTile: tile, waterTile: sea });
      }
    }
  }
  candidates(landComponent: number, waterComponent: number): readonly Coast[] {
    return this.edges.get(`${landComponent}:${waterComponent}`) ?? [];
  }
  connections(): {
    landComponent: number;
    waterComponent: number;
    edges: readonly Coast[];
  }[] {
    return [...this.edges].map(([key, edges]) => {
      const [landComponent, waterComponent] = key.split(":").map(Number);
      return { landComponent, waterComponent, edges };
    });
  }
}
