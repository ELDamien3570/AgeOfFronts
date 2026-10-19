import {TICKS_PER_SECOND} from './Protocol';
import { GameMapImpl, type GameMap } from "../core/game/GameMap";
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
  private readonly indexed: boolean;
  private readonly width: number;
  private readonly height: number;
  constructor(
    readonly map: GameMap,
    medium: PathMedium | boolean,
  ) {
    this.indexed = map instanceof GameMapImpl;
    this.width = map.width();
    this.height = map.height();
    this.medium = typeof medium === "string" ? medium : medium ? "water" : "land";
    this.water = this.medium === "water";
    this.amphibious = this.medium === "amphibious";
    const size = map.width() * map.height();
    // Skirmish terrain/component geometry is immutable after map creation.
    // Forest clearing changes costs, and continues through the listener below.
    this.passable = new Uint8Array(size);
    for (let tile = 0; tile < size; tile++) this.passable[tile] = Number(
      this.water ? map.isWater(tile) : this.amphibious || map.isLand(tile));
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
    this.cardinal[tile] = Math.ceil(11200 / (speed*TICKS_PER_SECOND));
    this.diagonal[tile] = Math.ceil(15840 / (speed*TICKS_PER_SECOND));
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
  // Side tiles whose `blocked` result the last neighbors() call established
  // as clear, so a search need not ask its pure blocked predicate again.
  private readonly clearSides = new Int32Array(4).fill(-1);
  private clearSidesFor?: (tile: number) => boolean;
  /** True when the previous neighbors() call, made with this same blocked
   * predicate, already found `tile` walkable and not blocked. */
  knownClear(tile: number, blocked: (tile: number) => boolean): boolean {
    if (blocked !== this.clearSidesFor) return false;
    const sides = this.clearSides;
    return sides[0] === tile || sides[1] === tile || sides[2] === tile || sides[3] === tile;
  }
  /** cost(a, b) when the caller already knows whether the step is diagonal. */
  stepCost(a: number, b: number, diagonal: boolean): number {
    const step = diagonal ? this.diagonal[b] : this.cardinal[b];
    return this.amphibious && this.map.isLand(a) !== this.map.isLand(b) ? step + EMBARK_COST : step;
  }
  neighbors(
    tile: number,
    output: number[],
    blocked?: (tile: number) => boolean,
  ): number {
    let count = this.map.neighbors4(tile, output);
    if (this.water) return count;
    if (this.indexed && Number.isInteger(tile)) return this.diagonalNeighbors(tile, output, count, blocked);
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
  /** The loop above with row-major index arithmetic (GameMapImpl: ref =
   * y * width + x) and each side's blocked result asked at most once. The
   * output order and every walkable/blocked outcome are unchanged. */
  private diagonalNeighbors(
    tile: number,
    output: number[],
    count: number,
    blocked?: (tile: number) => boolean,
  ): number {
    const w = this.width, h = this.height, passable = this.passable, x = tile % w, y = (tile / w) | 0;
    const sides = this.clearSides;
    sides[0] = sides[1] = sides[2] = sides[3] = -1;
    this.clearSidesFor = blocked;
    // Side states for this call: 0 unknown, 1 clear, 2 blocked.
    let left = 0, right = 0, up = 0, down = 0;
    for (let i = 0; i < 4; i++) {
      // DIAGONALS order: (-1,-1), (-1,1), (1,-1), (1,1).
      const dx = i < 2 ? -1 : 1, dy = i & 1 ? 1 : -1, nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const sideX = y * w + nx, sideY = ny * w + x;
      if (passable[sideX] === 0 || passable[sideY] === 0) continue;
      if (blocked) {
        let stateX = dx < 0 ? left : right;
        if (stateX === 0) {
          stateX = blocked(sideX) ? 2 : 1;
          if (dx < 0) { left = stateX; if (stateX === 1) sides[0] = sideX; }
          else { right = stateX; if (stateX === 1) sides[1] = sideX; }
        }
        if (stateX === 2) continue;
        let stateY = dy < 0 ? up : down;
        if (stateY === 0) {
          stateY = blocked(sideY) ? 2 : 1;
          if (dy < 0) { up = stateY; if (stateY === 1) sides[2] = sideY; }
          else { down = stateY; if (stateY === 1) sides[3] = sideY; }
        }
        if (stateY === 2) continue;
      }
      const corner = ny * w + nx;
      if (this.amphibious) {
        const land = this.map.isLand(tile);
        if (this.map.isLand(sideX) !== land || this.map.isLand(sideY) !== land ||
          this.map.isLand(corner) !== land) continue;
      }
      output[count++] = corner;
    }
    return count;
  }
  cost(a: number, b: number): number {
    return this.stepCost(a, b, this.map.x(a) !== this.map.x(b) && this.map.y(a) !== this.map.y(b));
  }
  estimate(a: number, b: number): number {
    const dx = Math.abs(this.map.x(a) - this.map.x(b)),
      dy = Math.abs(this.map.y(a) - this.map.y(b));
    return this.water
      ? (dx + dy) * 10
      : Math.min(dx, dy) * 14 + Math.abs(dx - dy) * 10;
  }
}
