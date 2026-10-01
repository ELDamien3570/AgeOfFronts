import { restoreMap, restoreSet } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import { TICKS_PER_SECOND } from "../Protocol";

export const TERRITORY_ABSORPTION = Object.freeze({ maxCells: 2, seconds: 10, includeUnclaimed: true });

interface Pocket {
  owner: number;
  recipient: number;
  tiles: number[];
}
interface Pending extends Pocket {
  deadline: number;
}

// Domain policy with bounded local connectivity checks. Ownership mutations
// remain the simulation aggregate's responsibility, including capture credit.
export class TerritoryAbsorption {
  checkpoint() { return structuredClone({dirty:this.dirty, watched:this.watched, pending:this.pending}); }
  restore(saved: ReturnType<TerritoryAbsorption["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreSet(this.dirty,state.dirty);
    restoreSet(this.watched,state.watched);
    restoreMap(this.pending,state.pending);

  }

  private readonly dirty = new Set<number>();
  private readonly watched = new Set<number>();
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly map: GameMap) {}

  changed(tile: number): void {
    this.dirty.add(tile);
    for (const neighbor of this.map.neighbors(tile)) this.dirty.add(neighbor);
  }

  step(
    tick: number,
    owners: Uint8Array,
    hasBuilding: (tile: number) => boolean,
    hostile: (owner: number, recipient: number) => boolean,
  ): readonly Pocket[] {
    if (tick % TICKS_PER_SECOND !== 0) return [];
    const checks = new Set([...this.dirty, ...this.watched]);
    this.dirty.clear();
    this.watched.clear();
    const pockets = new Map<number, Pocket>();
    for (const tile of checks) {
      const pocket = this.inspect(tile, owners);
      if (pocket) pockets.set(pocket.tiles[0], pocket);
    }
    const ready: Pocket[] = [];
    for (const [root, pocket] of pockets) {
      // Keep structurally valid pockets watched so building removal or an
      // alliance change can start/reset decay without an ownership mutation.
      this.watched.add(root);
      if (
        pocket.tiles.some(hasBuilding) ||
        (pocket.owner !== 0 && !hostile(pocket.owner, pocket.recipient))
      ) {
        this.pending.delete(root);
        continue;
      }
      const previous = this.pending.get(root);
      if (
        !previous ||
        previous.owner !== pocket.owner ||
        previous.recipient !== pocket.recipient ||
        previous.tiles.join(",") !== pocket.tiles.join(",")
      ) {
        this.pending.set(root, {
          ...pocket,
          deadline: tick + TERRITORY_ABSORPTION.seconds * TICKS_PER_SECOND,
        });
      } else if (tick >= previous.deadline) {
        ready.push(pocket);
        this.pending.delete(root);
      }
    }
    for (const root of this.pending.keys())
      if (!pockets.has(root)) this.pending.delete(root);
    return ready.sort((a, b) => a.tiles[0] - b.tiles[0]);
  }

  private inspect(start: number, owners: Uint8Array): Pocket | undefined {
    const owner = owners[start];
    if ((!owner && !TERRITORY_ABSORPTION.includeUnclaimed) || !this.map.isLand(start)) return;
    const tiles = [start];
    let recipient = 0;
    for (let at = 0; at < tiles.length; at++) {
      const neighbors = this.map.neighbors(tiles[at]);
      if (neighbors.length !== 4) return; // An open map edge is not enclosed.
      for (const neighbor of neighbors) {
        if (!this.map.isLand(neighbor)) return;
        if (owners[neighbor] === owner) {
          if (!tiles.includes(neighbor)) {
            tiles.push(neighbor);
            if (tiles.length > TERRITORY_ABSORPTION.maxCells) return;
          }
        } else {
          if (!owners[neighbor]) return; // Enemy pockets bordering neutral land stay open.
          if (recipient && recipient !== owners[neighbor]) return;
          recipient = owners[neighbor];
        }
      }
    }
    return recipient
      ? { owner, recipient, tiles: tiles.sort((a, b) => a - b) }
      : undefined;
  }
}
