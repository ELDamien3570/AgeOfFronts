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
  private readonly byWater = new Map<number, Coast[]>();
  constructor(map: GameMap, land: LandPaths, water: WaterPaths) {
    for (let tile = 0; tile < land.component.length; tile++) {
      if (!land.walkable(tile)) continue;
      for (const sea of map.neighbors(tile)) {
        if (!water.walkable(sea)) continue;
        const key = `${land.component[tile]}:${water.component[sea]}`;
        let edges = this.edges.get(key);
        if (!edges) this.edges.set(key, (edges = []));
        const edge = { landTile: tile, waterTile: sea };
        edges.push(edge);
        let seaEdges = this.byWater.get(water.component[sea]);
        if (!seaEdges) this.byWater.set(water.component[sea], (seaEdges = []));
        seaEdges.push(edge);
      }
    }
  }
  /** Every coast edge on one sea, ordered by land tile then neighbour order. */
  waterEdges(waterComponent: number): readonly Coast[] {
    return this.byWater.get(waterComponent) ?? [];
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
