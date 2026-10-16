import type { Snapshot } from "../Protocol";
type Expansion = NonNullable<Snapshot["expansion"]>;
/** Trusted worker-to-view message, never a network format. Canonical validation
 * precedes this projection. postMessage isolates entity graphs; only the owned
 * sparse tile buffer is transferred, never canonical map buffers. */
export interface PresentationState {
  snapshot: Omit<Snapshot, "owners" | "claims" | "progress" | "changedTiles" | "expansion"> & {
    expansion?: Omit<Expansion, "roads" | "deposits"> & Partial<Pick<Expansion, "roads" | "deposits">>;
  };
  tiles: Uint32Array;
  reset: boolean;
  /** N4: "delta" views carry only squad rows changed since the last presented
   * view, plus removed ids; absent or "full" carries every row. */
  squadMode?: "full" | "delta";
  removedSquads?: number[];
}
/** Apply only when presented: discarded views must not change renderer maps. */
export class PresentationStateDecoder {
  private owners = new Uint8Array();
  private claims = new Uint8Array();
  private progress = new Uint8Array();
  private width = 0;
  private height = 0;
  private roads?: Expansion["roads"];
  private deposits?: Expansion["deposits"];
  private squads?: Map<number, Snapshot["squads"][number]>;
  apply(view: PresentationState): Snapshot {
    const { snapshot, tiles, reset } = view;
    // Validate the squad view before touching any retained state.
    if (view.squadMode !== undefined && view.squadMode !== "full" && view.squadMode !== "delta") throw new Error("Invalid presentation squad mode");
    if (view.squadMode === "delta" && (reset || !this.squads)) throw new Error("Presentation squads require a baseline");
    if (reset) {
      this.width = snapshot.width; this.height = snapshot.height;
      const size = this.width * this.height;
      this.owners = new Uint8Array(size); this.claims = new Uint8Array(size); this.progress = new Uint8Array(size);
      this.roads = undefined; this.deposits = undefined;
    } else if (snapshot.width !== this.width || snapshot.height !== this.height || !this.owners.length) {
      throw new Error("Presentation requires a matching baseline");
    }
    const changedTiles = reset ? undefined : new Uint32Array(tiles.length / 2);
    for (let at = 0; at < tiles.length; at += 2) {
      const tile = tiles[at], value = tiles[at + 1];
      this.owners[tile] = value & 255; this.claims[tile] = (value >>> 8) & 255; this.progress[tile] = (value >>> 16) & 255;
      if (changedTiles) changedTiles[at / 2] = tile;
    }
    let expansion: Snapshot["expansion"];
    if (snapshot.expansion) {
      this.roads = snapshot.expansion.roads ?? this.roads;
      this.deposits = snapshot.expansion.deposits ?? this.deposits;
      if (!this.roads || !this.deposits) throw new Error("Presentation geometry requires a baseline");
      expansion = { ...snapshot.expansion, roads: this.roads, deposits: this.deposits };
    }
    let squads = snapshot.squads;
    if (view.squadMode === "delta") {
      // Mirrors the canonical decoder: removals first, then rows in canonical order.
      for (const id of view.removedSquads ?? []) this.squads!.delete(id);
      for (const squad of snapshot.squads) this.squads!.set(squad.id, squad);
      squads = [...this.squads!.values()];
    } else this.squads = new Map(snapshot.squads.map(squad => [squad.id, squad]));
    return { ...snapshot, squads, owners: this.owners, claims: this.claims, progress: this.progress, changedTiles, expansion };
  }
}
