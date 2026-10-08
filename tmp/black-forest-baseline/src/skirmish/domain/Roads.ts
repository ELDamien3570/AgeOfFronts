import { restoreMap } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import { AGES, type Age } from "./Definitions";

// Cosmetic infrastructure generated from legal trade routes. It neither alters
// path costs nor makes an otherwise blocked route traversable. Cardinal masks
// match the authored art; diagonal route edges need two legal cardinal legs.
export class Roads {
  checkpoint() { return structuredClone({tiles:this.tiles, cache:this.cache, dirty:this.dirty, revision:this.revision}); }
  restore(saved: ReturnType<Roads["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreMap(this.tiles,state.tiles);
    this.cache=state.cache;
    this.dirty=state.dirty;
    this.revision=state.revision;

  }

  private readonly tiles = new Map<number, Age>();
  private cache = new Uint32Array();
  private dirty = false;
  revision = 0;
  constructor(private readonly map: GameMap) {}
  add(path: readonly number[], age: Age): void {
    if (age === "StoneAge") return;
    let changed = false;
    const add = (tile: number) => {
      if (this.tiles.size >= 20000 && !this.tiles.has(tile)) return;
      const previous = this.tiles.get(tile);
      if (!previous || AGES.indexOf(previous) < AGES.indexOf(age)) {
        this.tiles.set(tile, age);
        this.dirty = true;
        changed = true;
      }
    };
    for (let i = 0; i < path.length; i++) {
      const tile = path[i];
      if (!this.map.isLand(tile)) continue;
      add(tile);
      if (!i) continue;
      const a = path[i - 1],
        dx = this.map.x(tile) - this.map.x(a),
        dy = this.map.y(tile) - this.map.y(a);
      if (dx && dy) {
        const elbow = this.map.ref(this.map.x(tile), this.map.y(a));
        if (this.map.isLand(elbow)) add(elbow);
        else {
          const other = this.map.ref(this.map.x(a), this.map.y(tile));
          if (this.map.isLand(other)) add(other);
        }
      }
    }
    if (changed) this.revision++;
  }
  packed(): Uint32Array {
    if (!this.dirty) return this.cache;
    this.cache = new Uint32Array(this.tiles.size * 3);
    let index = 0;
    for (const [tile, age] of [...this.tiles].sort(([a], [b]) => a - b)) {
      let mask = 0;
      for (const [dx, dy, bit] of [
        [0, -1, 1],
        [1, 0, 2],
        [0, 1, 4],
        [-1, 0, 8],
      ]) {
        const x = this.map.x(tile) + dx,
          y = this.map.y(tile) + dy;
        if (this.map.isValidCoord(x, y) && this.tiles.has(this.map.ref(x, y)))
          mask |= bit;
      }
      this.cache[index++] = tile;
      this.cache[index++] = AGES.indexOf(age);
      this.cache[index++] = mask;
    }
    this.dirty = false;
    return this.cache;
  }
}
