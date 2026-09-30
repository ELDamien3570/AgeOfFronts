import type { GameMap } from "../core/game/GameMap";
import { forestOf } from "./Forest";
import { terrainSpeed } from "./Terrain";

const DIAGONALS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

// One cost/passability contract for exact and hierarchical routing.
export class PathTopology {
  private readonly cardinal: Uint8Array;
  private readonly diagonal: Uint8Array;
  private readonly listeners = new Set<(tiles: readonly number[]) => void>();
  constructor(
    readonly map: GameMap,
    readonly water: boolean,
  ) {
    const size = map.width() * map.height();
    this.cardinal = new Uint8Array(size);
    this.diagonal = new Uint8Array(size);
    for (let tile = 0; tile < size; tile++) {
      this.updateCost(tile);
    }
    if (!water)
      forestOf(map)?.onChange((tiles) => {
        for (const tile of tiles) this.updateCost(tile);
        for (const listener of this.listeners) listener(tiles);
      });
  }
  private updateCost(tile: number): void {
    if (!this.walkable(tile)) return;
    const speed = this.water ? 56 : terrainSpeed(this.map, tile);
    this.cardinal[tile] = this.water ? 10 : Math.ceil(560 / speed);
    this.diagonal[tile] = Math.ceil(792 / speed);
  }
  onCostsChanged(listener: (tiles: readonly number[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  walkable(tile: number): boolean {
    return (
      Number.isInteger(tile) &&
      this.map.isValidRef(tile) &&
      (this.water ? this.map.isWater(tile) : this.map.isLand(tile)) &&
      !this.map.isImpassable(tile)
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
      output[count++] = this.map.ref(x + dx, y + dy);
    }
    return count;
  }
  cost(a: number, b: number): number {
    return this.map.x(a) !== this.map.x(b) && this.map.y(a) !== this.map.y(b)
      ? this.diagonal[b]
      : this.cardinal[b];
  }
  estimate(a: number, b: number): number {
    const dx = Math.abs(this.map.x(a) - this.map.x(b)),
      dy = Math.abs(this.map.y(a) - this.map.y(b));
    return this.water
      ? (dx + dy) * 10
      : Math.min(dx, dy) * 14 + Math.abs(dx - dy) * 10;
  }
}
