import type { GameMap } from "../../core/game/GameMap";
import { elevationOf } from "../Elevation";
import { FIXED } from "../Protocol";

/** Immutable physical height data. Carrier roots are the sole squad sample. */
export class TacticalTerrain {
  readonly hasHeight: boolean;
  readonly clampCount: number;
  private readonly heightDm: Int32Array;
  constructor(readonly map: GameMap) {
    const source = elevationOf(map);
    this.hasHeight = !!source;
    // Shipped mountain maps exceed the proposed Int16 ceiling. Int32 avoids
    // clipping their relative heights and costs one immutable array per map.
    this.heightDm = new Int32Array(map.width() * map.height());
    let clamps = 0;
    if (source)
      for (let tile = 0; tile < this.heightDm.length; tile++) {
        const dm = Math.round(source.heightAt(tile) * 10);
        if (dm < -2147483648 || dm > 2147483647) clamps++;
        this.heightDm[tile] = Math.max(-2147483648, Math.min(2147483647, dm));
      }
    this.clampCount = clamps;
    if (clamps) throw Error("Physical terrain height exceeds Int32 decimetres");
  }
  heightAt(tile: number): number {
    return this.heightDm[tile] ?? 0;
  }
  height(point: { x: number; y: number }): number {
    const x = Math.max(
      0,
      Math.min(this.map.width() - 1, Math.floor(point.x / FIXED)),
    );
    const y = Math.max(
      0,
      Math.min(this.map.height() - 1, Math.floor(point.y / FIXED)),
    );
    return this.heightAt(this.map.ref(x, y));
  }
}
const terrains = new WeakMap<GameMap, TacticalTerrain>();
export function tacticalTerrain(map: GameMap): TacticalTerrain {
  let terrain = terrains.get(map);
  if (!terrain) {
    terrain = new TacticalTerrain(map);
    terrains.set(map, terrain);
  }
  return terrain;
}
