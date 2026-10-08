import type { GameMap } from "../core/game/GameMap";
import { forestOf } from "./Forest";
import { terrainSpeed } from "./Terrain";

const DIAGONALS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

/** Land (8-way), water (4-way), or amphibious squads that cross both. */
export type PathMedium = "land" | "water" | "amphibious";
/** Extra amphibious cost of a step between land and water, about two open
 * tiles: routes do not hop in and out of the water for marginal gains. */
export const EMBARK_COST = 20;

// One cost/passability contract for exact and hierarchical routing.
export class PathTopology {
  private readonly cardinal: Uint8Array;
  private readonly diagonal: Uint8Array;
  private readonly passable: Uint8Array;
  private readonly listeners = new Set<(tiles: readonly number[]) => void>();
  readonly medium: PathMedium;
  readonly water: boolean;
  private readonly amphibious: boolean;
  constructor(
    readonly map: GameMap,
    medium: PathMedium | boolean,
  ) {
    this.medium = typeof medium === "string" ? medium : medium ? "water" : "land";
    this.water = this.medium === "water";
    this.amphibious = this.medium === "amphibious";
    const size = map.width() * map.height();
    // Skirmish terrain/component geometry is immutable after map creation.
    // Forest clearing changes costs, and continues through the listener below.
    this.passable = new Uint8Array(size);
    for (let tile = 0; tile < size; tile++) this.passable[tile] = Number(
      (this.water ? map.isWater(tile) : this.amphibious || map.isLand(tile)) && !map.isImpassable(tile));
    this.cardinal = new Uint8Array(size);
    this.diagonal = new Uint8Array(size);
    for (let tile = 0; tile < size; tile++) {
      this.updateCost(tile);
    }
    if (!this.water)
      forestOf(map)?.onChange((tiles) => {
        for (const tile of tiles) this.updateCost(tile);
        for (const listener of this.listeners) listener(tiles);
      });
  }
  private updateCost(tile: number): void {
    if (!this.walkable(tile)) return;
    if (!this.map.isLand(tile)) {
      // Open water: the octile heuristic's minimum step, so it stays admissible.
      this.cardinal[tile] = 10;
      this.diagonal[tile] = 14;
      return;
    }
    const speed = terrainSpeed(this.map, tile);
    this.cardinal[tile] = Math.ceil(560 / speed);
    this.diagonal[tile] = Math.ceil(792 / speed);
  }
  onCostsChanged(listener: (tiles: readonly number[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  walkable(tile: number): boolean {
    return (
      Number.isInteger(tile) &&
      tile >= 0 && tile < this.passable.length && this.passable[tile] !== 0
    );
  }
  neighbors(
    tile: number,
    output: number[],
    blocked?: (tile: number) => boolean,
  ): number {
    let count = this.map.neighbors4(tile, output);
    if (this.water) return count;
    const x = this.map.x(tile),
      y = this.map.y(tile);
    for (const [dx, dy] of DIAGONALS) {
      if (!this.map.isValidCoord(x + dx, y + dy)) continue;
      const sideX = this.map.ref(x + dx, y),
        sideY = this.map.ref(x, y + dy);
      if (
        !this.walkable(sideX) ||
        !this.walkable(sideY) ||
        blocked?.(sideX) ||
        blocked?.(sideY)
      )
        continue;
      // Amphibious diagonals stay within one medium, so every embarkation is
      // a cardinal step and never cuts a coastline corner.
      if (this.amphibious) {
        const land = this.map.isLand(tile);
        if (this.map.isLand(sideX) !== land || this.map.isLand(sideY) !== land ||
          this.map.isLand(this.map.ref(x + dx, y + dy)) !== land) continue;
      }
      output[count++] = this.map.ref(x + dx, y + dy);
    }
    return count;
  }
  cost(a: number, b: number): number {
    const step = this.map.x(a) !== this.map.x(b) && this.map.y(a) !== this.map.y(b)
      ? this.diagonal[b]
      : this.cardinal[b];
    return this.amphibious && this.map.isLand(a) !== this.map.isLand(b) ? step + EMBARK_COST : step;
  }
  estimate(a: number, b: number): number {
    const dx = Math.abs(this.map.x(a) - this.map.x(b)),
      dy = Math.abs(this.map.y(a) - this.map.y(b));
    return this.water
      ? (dx + dy) * 10
      : Math.min(dx, dy) * 14 + Math.abs(dx - dy) * 10;
  }
}
