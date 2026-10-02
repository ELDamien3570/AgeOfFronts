import type { GameMap } from "../../core/game/GameMap";
import { TICKS_PER_SECOND } from "../Protocol";

export const NEUTRAL_TERRITORY_RULES = Object.freeze({
  maxOwnedFraction: 0.25, maxMapFraction: 0.05, layerSeconds: 10,
  waterCompletesBoundary: true, scanTilesPerTick: 2048,
});
interface Scan {
  tiles: number[]; head: number; seen: Set<number>; boundary: Set<number>; recipient: number;
}
interface Region { tiles: number[]; recipient: number; deadline?: number }
export interface NeutralClaim { owner: number; recipient: number; tiles: number[] }

// Connectivity discovery is spread across ticks. Valid regions are watched,
// so a broken enclosure or new building cancels the next inward wave.
export class NeutralTerritoryClaims {
  private dirty = new Set<number>();
  private pending = new Map<number, Region>();
  private indexed = new Map<number, number>();
  private scan?: Scan;
  private revision = 1;
  private rejected: Float64Array;
  constructor(private readonly map: GameMap) {
    this.rejected = new Float64Array(map.width() * map.height());
  }
  checkpoint() {
    return structuredClone({ dirty: this.dirty, pending: this.pending, scan: this.scan,
      revision: this.revision, rejected: this.rejected });
  }
  restore(saved: ReturnType<NeutralTerritoryClaims["checkpoint"]>) {
    const s = structuredClone(saved);
    this.dirty = s.dirty; this.pending = s.pending; this.scan = s.scan;
    this.revision = s.revision; this.rejected = s.rejected;
    this.indexed.clear();
    for (const [root, region] of this.pending)
      for (const tile of region.tiles) this.indexed.set(tile, root);
  }
  changed(tile: number) {
    this.revision++;
    this.dirty.add(tile);
    for (const n of this.map.neighbors(tile)) this.dirty.add(n);
    if (this.scan && (this.scan.seen.has(tile) || this.scan.boundary.has(tile))) {
      this.dirty.add(this.scan.tiles[0]);
      this.scan = undefined;
    }
  }
  private discardScan() {
    for (const tile of this.scan!.tiles) this.rejected[tile] = this.revision;
    this.scan = undefined;
  }
  step(tick: number, owners: Uint8Array, hasBuilding: (tile: number) => boolean,
    ownedLand: (owner: number) => number): NeutralClaim[] {
    const maxCells = Math.floor(this.map.numLandTiles() * NEUTRAL_TERRITORY_RULES.maxMapFraction);
    let budget = NEUTRAL_TERRITORY_RULES.scanTilesPerTick;
    while (budget > 0) {
      if (!this.scan) {
        const seed = this.dirty.values().next().value as number | undefined;
        if (seed === undefined) break;
        this.dirty.delete(seed); budget--;
        if (owners[seed] || !this.map.isLand(seed) || this.indexed.has(seed) || this.rejected[seed] === this.revision) continue;
        this.scan = { tiles: [seed], head: 0, seen: new Set([seed]), boundary: new Set(), recipient: 0 };
      }
      const scan = this.scan;
      if (scan.head === scan.tiles.length) {
        if (!scan.recipient) { this.discardScan(); continue; }
        const tiles = scan.tiles.sort((a,b) => a-b), root = tiles[0];
        this.pending.set(root, { tiles, recipient: scan.recipient });
        for (const tile of tiles) { this.indexed.set(tile, root); this.dirty.delete(tile); }
        this.scan = undefined; continue;
      }
      const tile = scan.tiles[scan.head++]; budget--;
      const neighbors = this.map.neighbors(tile);
      let invalid = neighbors.length !== 4 || owners[tile] !== 0;
      for (const n of neighbors) {
        if (!this.map.isLand(n)) continue;
        if (!owners[n]) {
          if (this.rejected[n] === this.revision || this.indexed.has(n)) { invalid = true; break; }
          if (!scan.seen.has(n)) { scan.seen.add(n); scan.tiles.push(n); }
          if (scan.tiles.length > maxCells) { invalid = true; break; }
        } else {
          scan.boundary.add(n);
          if (scan.recipient && scan.recipient !== owners[n]) { invalid = true; break; }
          scan.recipient = owners[n];
        }
      }
      if (invalid) this.discardScan();
    }
    if (tick % TICKS_PER_SECOND) return [];
    const ready: NeutralClaim[] = [];
    for (const [root, region] of this.pending) {
      const remaining = region.tiles.filter(t => owners[t] === 0 && this.map.isLand(t));
      let invalid = region.tiles.some(t => this.map.isLand(t) && owners[t] !== 0 && owners[t] !== region.recipient);
      const frontier: number[] = [];
      for (const tile of remaining) {
        const neighbors = this.map.neighbors(tile);
        if (neighbors.length !== 4) invalid = true;
        let adjacent = false;
        for (const n of neighbors) {
          if (!this.map.isLand(n)) continue;
          if (!owners[n]) {
            if (this.indexed.get(n) !== root) invalid = true;
          } else if (owners[n] !== region.recipient) invalid = true;
          else adjacent = true;
        }
        if (adjacent) frontier.push(tile);
      }
      if (invalid || !remaining.length) {
        this.pending.delete(root);
        for (const tile of region.tiles) this.indexed.delete(tile);
        if (remaining.length) this.dirty.add(remaining[0]);
        continue;
      }
      if (remaining.length > maxCells || remaining.length > Math.floor(ownedLand(region.recipient) * NEUTRAL_TERRITORY_RULES.maxOwnedFraction) || region.tiles.some(hasBuilding)) {
        region.deadline = undefined; continue;
      }
      if (region.deadline === undefined) region.deadline = tick + NEUTRAL_TERRITORY_RULES.layerSeconds * TICKS_PER_SECOND;
      else if (tick >= region.deadline && frontier.length) {
        ready.push({ owner: 0, recipient: region.recipient, tiles: frontier });
        region.deadline = tick + NEUTRAL_TERRITORY_RULES.layerSeconds * TICKS_PER_SECOND;
      }
    }
    return ready.sort((a,b) => a.tiles[0]-b.tiles[0]);
  }
}
