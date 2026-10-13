import type { GameMap } from "../../core/game/GameMap";
import { TICKS_PER_SECOND } from "../Protocol";

export const NEUTRAL_TERRITORY_RULES = Object.freeze({
  maxOwnedFraction: 0.25,
  maxMapFraction: 0.05,
  layerSeconds: 10,
  waterCompletesBoundary: true,
  scanTilesPerTick: 2048,
});
interface Scan {
  tiles: number[];
  head: number;
  seen: Set<number>;
  boundary: Set<number>;
  recipient: number;
}
interface Region {
  tiles: number[];
  recipient: number;
  deadline?: number;
}
export interface NeutralClaim {
  owner: number;
  recipient: number;
  tiles: number[];
}

// Connectivity discovery is spread across ticks. Valid regions are watched,
// so a broken enclosure or new building cancels the next inward wave.
export class NeutralTerritoryClaims {
  private dirty = new Set<number>();
  private pending = new Map<number, Region>();
  private indexed = new Map<number, number>();
  private scan?: Scan;
  // Derived cell facts: ownership changes dirty only their region/neighbours.
  // Checkpoints retain canonical pending regions; restore discards this cache.
  private validation = new WeakMap<Region, { remaining: Set<number>; frontier: Set<number>; invalid: Set<number>; dirty: Set<number> }>();
  private validationOf(region: Region) {
    let state = this.validation.get(region);
    if (!state) {
      state = { remaining: new Set<number>(), frontier: new Set<number>(), invalid: new Set<number>(), dirty: new Set(region.tiles) };
      this.validation.set(region, state);
    }
    return state;
  }
  private validateCells(root: number, region: Region, owners: Uint8Array, budget: number): number {
    const state = this.validationOf(region);
    let used = 0;
    for (const tile of state.dirty) {
      if (used >= budget) break;
      state.dirty.delete(tile); used++;
      state.remaining.delete(tile); state.frontier.delete(tile); state.invalid.delete(tile);
      if (!this.map.isLand(tile)) continue;
      if (owners[tile]) { if (owners[tile] !== region.recipient) state.invalid.add(tile); continue; }
      state.remaining.add(tile);
      const neighbors = this.map.neighbors(tile);
      let invalid = neighbors.length !== 4, adjacent = false;
      for (const n of neighbors) {
        if (!this.map.isLand(n)) continue;
        if (!owners[n]) { if (this.indexed.get(n) !== root) invalid = true; }
        else if (owners[n] !== region.recipient) invalid = true;
        else adjacent = true;
      }
      if (invalid) state.invalid.add(tile);
      if (adjacent) state.frontier.add(tile);
    }
    return used;
  }

  private revision = 1;
  private rejectedRevision = 0;
  private rejected: Uint8Array;
  constructor(private readonly map: GameMap) {
    this.rejected = new Uint8Array(Math.ceil((map.width() * map.height()) / 8));
  }
  checkpoint() {
    return structuredClone({
      dirty: this.dirty,
      pending: this.pending,
      scan: this.scan
        ? {
            tiles: Uint32Array.from(this.scan.tiles),
            head: this.scan.head,
            recipient: this.scan.recipient,
          }
        : undefined,
      revision: this.revision,
      rejectedRevision: this.rejectedRevision,
      rejected: this.rejected,
    });
  }
  restore(saved: ReturnType<NeutralTerritoryClaims["checkpoint"]>) {
    const s = structuredClone(saved);
    this.dirty = s.dirty;
    this.pending = s.pending;
    this.scan = s.scan
      ? {
          ...s.scan,
          tiles: Array.from(s.scan.tiles),
          seen: new Set(s.scan.tiles),
          boundary: new Set(),
        }
      : undefined;
    if (this.scan)
      for (const tile of this.scan.tiles)
        for (const n of this.map.neighbors(tile))
          if (!this.scan.seen.has(n)) this.scan.boundary.add(n);
    this.revision = s.revision;
    this.rejectedRevision = s.rejectedRevision;
    this.rejected = s.rejected;
    this.validation = new WeakMap();
    this.indexed.clear();
    for (const [root, region] of this.pending)
      for (const tile of region.tiles) this.indexed.set(tile, root);
  }
  changed(tile: number) {
    this.revision = (this.revision + 1) >>> 0;
    if (!this.revision) {
      this.rejected.fill(0);
      this.revision = 1;
    }
    this.dirty.add(tile);
    const affected = [tile, ...this.map.neighbors(tile)];
    for (const cell of affected) {
      this.dirty.add(cell);
      const root = this.indexed.get(cell), region = root === undefined ? undefined : this.pending.get(root);
      if (region) this.validationOf(region).dirty.add(cell);
    }
    if (
      this.scan &&
      (this.scan.seen.has(tile) || this.scan.boundary.has(tile))
    ) {
      this.dirty.add(this.scan.tiles[0]);
      this.scan = undefined;
    }
  }
  private discardScan() {
    for (const tile of this.scan!.tiles)
      this.rejected[tile >> 3] |= 1 << (tile & 7);
    this.scan = undefined;
  }
  private wasRejected(tile: number): boolean {
    return Boolean(this.rejected[tile >> 3] & (1 << (tile & 7)));
  }
  step(
    tick: number,
    owners: Uint8Array,
    hasBuilding: (tile: number) => boolean,
    ownedLand: (owner: number) => number,
  ): NeutralClaim[] {
    if (this.rejectedRevision !== this.revision) {
      this.rejected.fill(0);
      this.rejectedRevision = this.revision;
    }
    const maxCells = Math.floor(
      this.map.numLandTiles() * NEUTRAL_TERRITORY_RULES.maxMapFraction,
    );
    let budget = NEUTRAL_TERRITORY_RULES.scanTilesPerTick;
    while (budget > 0) {
      if (!this.scan) {
        const seed = this.dirty.values().next().value as number | undefined;
        if (seed === undefined) break;
        this.dirty.delete(seed);
        budget--;
        if (
          owners[seed] ||
          !this.map.isLand(seed) ||
          this.indexed.has(seed) ||
          this.wasRejected(seed)
        )
          continue;
        this.scan = {
          tiles: [seed],
          head: 0,
          seen: new Set([seed]),
          boundary: new Set(this.map.neighbors(seed)),
          recipient: 0,
        };
      }
      const scan = this.scan;
      if (scan.head === scan.tiles.length) {
        if (!scan.recipient) {
          this.discardScan();
          continue;
        }
        const tiles = scan.tiles.sort((a, b) => a - b),
          root = tiles[0];
        this.pending.set(root, { tiles, recipient: scan.recipient });
        for (const tile of tiles) {
          this.indexed.set(tile, root);
          this.dirty.delete(tile);
        }
        this.scan = undefined;
        continue;
      }
      const tile = scan.tiles[scan.head++];
      budget--;
      const neighbors = this.map.neighbors(tile);
      let invalid = neighbors.length !== 4 || owners[tile] !== 0;
      for (const n of neighbors) {
        if (!this.map.isLand(n)) continue;
        if (!owners[n]) {
          if (this.wasRejected(n) || this.indexed.has(n)) {
            invalid = true;
            break;
          }
          if (!scan.seen.has(n)) {
            scan.seen.add(n);
            scan.boundary.delete(n);
            for (const next of this.map.neighbors(n))
              if (!scan.seen.has(next)) scan.boundary.add(next);
            scan.tiles.push(n);
          }
          if (scan.tiles.length > maxCells) {
            invalid = true;
            break;
          }
        } else {
          scan.boundary.add(n);
          if (scan.recipient && scan.recipient !== owners[n]) {
            invalid = true;
            break;
          }
          scan.recipient = owners[n];
        }
      }
      if (invalid) this.discardScan();
    }
    let validationBudget = NEUTRAL_TERRITORY_RULES.scanTilesPerTick;
    for (const [root, region] of this.pending) {
      validationBudget -= this.validateCells(root, region, owners, validationBudget);
      if (validationBudget <= 0) break;
    }
    if (tick % TICKS_PER_SECOND) return [];
    const ready: NeutralClaim[] = [];
    for (const [root, region] of this.pending) {
      // Finish only outstanding changes at the authoritative boundary. Never
      // publish a stale frontier or defer an already-due ownership layer.
      this.validateCells(root, region, owners, Infinity);
      const state = this.validationOf(region);
      const remaining = [...state.remaining].sort((a, b) => a - b);
      const frontier = [...state.frontier].sort((a, b) => a - b);
      const invalid = state.invalid.size > 0;
      if (invalid || !remaining.length) {
        this.pending.delete(root);
        for (const tile of region.tiles) this.indexed.delete(tile);
        if (remaining.length) this.dirty.add(remaining[0]);
        continue;
      }
      if (
        remaining.length > maxCells ||
        remaining.length >
          Math.floor(
            ownedLand(region.recipient) *
              NEUTRAL_TERRITORY_RULES.maxOwnedFraction,
          ) ||
        remaining.some(hasBuilding)
      ) {
        region.deadline = undefined;
        continue;
      }
      if (region.deadline === undefined)
        region.deadline =
          tick + NEUTRAL_TERRITORY_RULES.layerSeconds * TICKS_PER_SECOND;
      else if (tick >= region.deadline && frontier.length) {
        ready.push({ owner: 0, recipient: region.recipient, tiles: frontier });
        region.deadline =
          tick + NEUTRAL_TERRITORY_RULES.layerSeconds * TICKS_PER_SECOND;
      }
    }
    return ready.sort((a, b) => a.tiles[0] - b.tiles[0]);
  }
}
