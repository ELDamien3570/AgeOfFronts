import type { GameMap } from "../../core/game/GameMap";
import { TICKS_PER_SECOND, type Ship } from "../Protocol";
import { pointTile } from "../SquadGeometry";
import {
  COASTAL_TERRITORY_RULES,
  coastalRanges,
} from "../content/CoastalTerritory";

interface Right {
  owner: number;
  shore: number;
  distance: number;
}
interface Pending extends Right {
  progress: number;
}
export class CoastalTerritory {
  private dirty = new Set<number>();
  private rights = new Map<number, Right>();
  private pending = new Map<number, Pending>();
  private byShore = new Map<number, Set<number>>();
  constructor(private readonly map: GameMap) {}
  checkpoint() {
    return structuredClone({
      dirty: this.dirty,
      rights: this.rights,
      pending: this.pending,
    });
  }
  restore(saved: ReturnType<CoastalTerritory["checkpoint"]>) {
    const s = structuredClone(saved);
    this.dirty = s.dirty;
    this.rights = s.rights;
    this.pending = s.pending;
    this.byShore.clear();
    for (const [tile, right] of this.rights) this.index(tile, right.shore);
  }
  private index(tile: number, shore: number) {
    const set = this.byShore.get(shore) ?? new Set<number>();
    set.add(tile);
    this.byShore.set(shore, set);
  }
  changed(tile: number) {
    this.dirty.add(tile);
    for (const n of this.map.neighbors(tile)) this.dirty.add(n);
  }
  private candidate(tile: number, owners: Uint8Array): Right | undefined {
    const limit = coastalRanges(this.map).claimTiles;
    let best: Right | undefined,
      contested = false;
    for (const n of this.map.neighbors(tile)) {
      const prior = this.rights.get(n);
      const next =
        this.map.isLand(n) && owners[n]
          ? { owner: owners[n], shore: n, distance: 1 }
          : prior &&
              owners[n] === prior.owner &&
              owners[prior.shore] === prior.owner &&
              this.map.isLand(prior.shore)
            ? { ...prior, distance: prior.distance + 1 }
            : undefined;
      if (!next || next.distance > limit) continue;
      if (!best || next.distance < best.distance) {
        best = next;
        contested = false;
      } else if (next.distance === best.distance) {
        if (next.owner !== best.owner) contested = true;
        else if (next.shore < best.shore) best = next;
      }
    }
    return contested ? undefined : best;
  }
  step(
    tick: number,
    owners: Uint8Array,
    ships: readonly Ship[],
  ): { tile: number; owner: number }[] {
    if (tick % TICKS_PER_SECOND) return [];
    const changes: { tile: number; owner: number }[] = [];
    // Coastal rights depend on their originating shore, never on boats or a
    // chain of already claimed water. Losing that shore relinquishes its water.
    for (const shore of this.dirty)
      for (const tile of this.byShore.get(shore) ?? []) {
        const right = this.rights.get(tile)!;
        if (
          this.map.isLand(shore) &&
          owners[shore] &&
          owners[tile] === owners[shore]
        ) {
          right.owner = owners[shore];
          continue;
        }
        if (this.map.isLand(shore) && owners[shore] === right.owner) continue;
        if (owners[tile] === right.owner) changes.push({ tile, owner: 0 });
        this.rights.delete(tile);
        this.dirty.add(tile);
        for (const n of this.map.neighbors(tile)) this.dirty.add(n);
        this.byShore.get(shore)!.delete(tile);
      }
    const accelerated = new Map<number, Set<number>>();
    const radius = coastalRanges(this.map).boatRadius;
    for (const ship of ships) {
      if (ship.health <= 0) continue;
      const tile = pointTile(this.map, ship),
        sx = this.map.x(tile),
        sy = this.map.y(tile);
      const set = accelerated.get(ship.playerId) ?? new Set<number>();
      for (
        let y = Math.max(0, sy - radius);
        y <= Math.min(this.map.height() - 1, sy + radius);
        y++
      )
        for (
          let x = Math.max(0, sx - radius);
          x <= Math.min(this.map.width() - 1, sx + radius);
          x++
        )
          if ((x - sx) ** 2 + (y - sy) ** 2 <= radius ** 2)
            set.add(this.map.ref(x, y));
      accelerated.set(ship.playerId, set);
    }
    const checks = new Set([...this.dirty, ...this.pending.keys()]);
    this.dirty.clear();
    const relinquished = new Set(changes.map((c) => c.tile));
    for (const tile of checks) {
      if (!this.map.isWater(tile) || owners[tile] || relinquished.has(tile)) {
        this.pending.delete(tile);
        continue;
      }
      const next = this.candidate(tile, owners);
      if (!next) {
        this.pending.delete(tile);
        continue;
      }
      const previous = this.pending.get(tile);
      const progress =
        (previous?.owner === next.owner &&
        previous.shore === next.shore &&
        previous.distance === next.distance
          ? previous.progress
          : 0) +
        (accelerated.get(next.owner)?.has(tile)
          ? COASTAL_TERRITORY_RULES.boatMultiplier
          : 1);
      if (progress < COASTAL_TERRITORY_RULES.layerSeconds)
        this.pending.set(tile, { ...next, progress });
      else {
        this.pending.delete(tile);
        this.rights.set(tile, next);
        this.index(tile, next.shore);
        changes.push({ tile, owner: next.owner });
      }
    }
    return changes.sort((a, b) => a.tile - b.tile);
  }
}
