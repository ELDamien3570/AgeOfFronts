import type { GameMap } from "../core/game/GameMap";
import { buildingNavigationClearedBounds } from "./BuildingFootprint";
import type { Building, BuildingType } from "./Protocol";

export interface ForestData {
  cover: Uint8Array;
}
type Changed = (tiles: readonly number[]) => void;

// Natural cover is immutable map data. Building occupancy is a separate match
// overlay, updated by domain construction and mirrored from snapshots in views.
export class ForestField {
  checkpoint() {
    return structuredClone({ cleared: this.cleared, sites: this.sites });
  }
  restore(state: ReturnType<ForestField["checkpoint"]>): void {
    if (state.cleared.length !== this.cleared.length)
      throw new Error("Invalid forest checkpoint");
    const changed = new Set<number>();
    for (let tile = 0; tile < this.cleared.length; tile++)
      if (Boolean(this.cleared[tile]) !== Boolean(state.cleared[tile]))
        changed.add(tile);
    this.cleared.set(state.cleared);
    this.sites.clear();
    for (const [tile, type] of state.sites) this.sites.set(tile, type);
    this.publish(changed);
  }
  private readonly cover: Uint8Array;
  private readonly cleared: Uint16Array;
  private readonly sites = new Map<number, BuildingType>();
  private readonly listeners = new Set<Changed>();
  constructor(size: number, data: ForestData) {
    if (!(data.cover instanceof Uint8Array) || data.cover.length !== size)
      throw new Error("Invalid forest cover field");
    this.cover = data.cover.slice();
    this.cleared = new Uint16Array(size);
  }
  naturalCoverAt(tile: number): number {
    return this.cover[tile] / 255;
  }
  coverAt(tile: number): number {
    return this.cleared[tile] ? 0 : this.naturalCoverAt(tile);
  }
  isCleared(tile: number): boolean {
    return this.cleared[tile] > 0;
  }
  onChange(listener: Changed): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private footprint(
    map: GameMap,
    tile: number,
    type: BuildingType,
    delta: number,
    changed: Set<number>,
  ) {
    const bounds = buildingNavigationClearedBounds(map, tile, type);
    // Preserve the established navigation clearing mask. Occupied artwork and
    // placement reservations do not enlarge soldier movement or path-cost effects.
    for (
      let y = Math.max(0, Math.floor(bounds.top));
      y < Math.min(map.height(), Math.ceil(bounds.bottom));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(bounds.left));
        x < Math.min(map.width(), Math.ceil(bounds.right));
        x++
      ) {
        const at = map.ref(x, y),
          wasCleared = this.cleared[at] > 0;
        this.cleared[at] += delta;
        if (wasCleared !== this.cleared[at] > 0) changed.add(at);
      }
  }
  occupy(map: GameMap, tile: number, type: BuildingType): void {
    if (this.sites.get(tile) === type) return;
    const changed = new Set<number>(),
      previous = this.sites.get(tile);
    this.footprint(map, tile, type, 1, changed);
    if (previous) this.footprint(map, tile, previous, -1, changed);
    this.sites.set(tile, type);
    this.publish(changed);
  }
  updateBuildings(
    map: GameMap,
    buildings: readonly Pick<Building, "tile" | "type">[],
  ): readonly number[] {
    const next = new Map(
        buildings.map((building) => [building.tile, building.type]),
      ),
      changed = new Set<number>();
    for (const [tile, type] of next)
      if (this.sites.get(tile) !== type)
        this.footprint(map, tile, type, 1, changed);
    for (const [tile, type] of this.sites)
      if (next.get(tile) !== type) this.footprint(map, tile, type, -1, changed);
    this.sites.clear();
    for (const [tile, type] of next) this.sites.set(tile, type);
    return this.publish(changed);
  }
  private publish(changed: Set<number>): readonly number[] {
    const tiles = Array.from(changed);
    if (tiles.length) for (const listener of this.listeners) listener(tiles);
    return tiles;
  }
}

export function forestOf(map: GameMap): ForestField | undefined {
  return "forest" in map && map.forest instanceof ForestField
    ? map.forest
    : undefined;
}
