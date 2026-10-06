import type { Snapshot, SnapshotPacket } from "../Protocol";
import { MAX_QUEUED_ORDERS, MAX_SQUADS } from "../Protocol";
import { SNAPSHOT_LAYOUT, SnapshotDecoder, SnapshotEncoder } from "../SnapshotCodec";
const {
  squadStride: SQUAD_STRIDE,
  orderStride: ORDER_STRIDE,
  buildingStride: BUILDING_STRIDE,
} = SNAPSHOT_LAYOUT;

/** Worker-owned canonical state. Network deltas are never presentation frames. */
export class CanonicalStateStream {
  private readonly decoder = new SnapshotDecoder();
  private acknowledgedRoadRevision = -1;
  private acknowledgedDepositRevision = -1;
  private readonly pendingGeometry = new Map<number, { roads: number; deposits: number }>();
  private latest?: Snapshot;
  private sequence = 0;
  private presented = 0;
  private resetSequence = 0;
  private depositRevision = 0;
  private projectedDepositRevision = -1;
  private projectedDeposits: NonNullable<Snapshot["expansion"]>["deposits"] = [];
  private readonly barrierViews = new Map<number, NonNullable<Snapshot["expansion"]>["barriers"][number]>();
  private projectedBarriers?: NonNullable<Snapshot["expansion"]>["barriers"];
  private readonly dirty = new Map<number, number>();
  constructor(
    private readonly maxMapCells = 64_000_000,
    private readonly maxDirtyTiles = 65_536,
    private readonly expectedMap?: { width: number; height: number },
  ) {}
  apply(packet: SnapshotPacket): void {
    this.decoder.validate(packet);
    if (
      this.expectedMap &&
      (packet.width !== this.expectedMap.width ||
        packet.height !== this.expectedMap.height)
    )
      throw new Error("Canonical dimensions differ from the loaded map");
    const cells = packet.width * packet.height;
    if (
      !Number.isSafeInteger(packet.width) ||
      packet.width <= 0 ||
      !Number.isSafeInteger(packet.height) ||
      packet.height <= 0 ||
      !Number.isSafeInteger(cells) ||
      cells > this.maxMapCells
    )
      throw new Error("Canonical map exceeds the decoded memory budget");
    if(packet.expansionMode!==undefined && packet.expansionMode!=="full" && packet.expansionMode!=="delta")throw new Error("Invalid canonical metadata mode");
    if (packet.entityMode !== undefined && packet.entityMode !== "full" && packet.entityMode !== "delta")
      throw new Error("Invalid canonical entity mode");
    for (const removed of [packet.removedSquads, packet.removedShips])
      if (removed !== undefined && (!(removed instanceof Int32Array) || removed.length > MAX_SQUADS * 255))
        throw new Error("Invalid canonical entity removals");
    if (!(packet.tiles instanceof Uint32Array) || packet.tiles.length % 2)
      throw new Error("Invalid canonical tile changes");
    if (
      !(packet.squads instanceof Int32Array) ||
      packet.squads.length % SQUAD_STRIDE ||
      packet.squads.length / SQUAD_STRIDE > MAX_SQUADS * 255 ||
      !(packet.orders instanceof Int32Array) ||
      packet.orders.length % ORDER_STRIDE ||
      !(packet.buildingChanges instanceof Int32Array) ||
      packet.buildingChanges.length % BUILDING_STRIDE ||
      !(packet.removedBuildings instanceof Int32Array)
    )
      throw new Error("Invalid canonical entity buffers");
    for (let at = 0; at < packet.squads.length; at += SQUAD_STRIDE) {
      const offset = packet.squads[at + 12],
        count = packet.squads[at + 13];
      if (
        offset < 0 ||
        count < 1 ||
        count > MAX_QUEUED_ORDERS + 1 ||
        offset + count > packet.orders.length / ORDER_STRIDE
      )
        throw new Error("Invalid canonical order range");
    }
    for (let at = 0; at < packet.tiles.length; at += 2)
      if (packet.tiles[at] >= cells)
        throw new Error("Canonical tile lies outside the map");
    if (
      this.latest &&
      (packet.width !== this.latest.width ||
        packet.height !== this.latest.height)
    )
      throw new Error("Canonical map dimensions changed");
    if (!this.latest && !packet.reset)
      throw new Error("A canonical stream needs a baseline before deltas");
    if (this.latest && packet.tick < this.latest.tick)
      throw new Error("Canonical updates arrived out of order");
    this.sequence++;
    if (packet.reset) {
      this.dirty.clear();
      this.resetSequence = this.sequence;
    }
    // Baseline pixels are already covered by the full-frame obligation; do
    // not allocate millions of redundant hash entries for them. A large delta
    // uses the same conservative obligation instead of an unbounded union.
    if (!packet.reset)
      for (let at = 0; at < packet.tiles.length; at += 2) {
        this.dirty.set(packet.tiles[at], this.sequence);
        if (this.dirty.size > this.maxDirtyTiles) {
          this.dirty.clear();
          this.resetSequence = this.sequence;
          break;
        }
      }
    this.latest = this.decoder.decode(packet, false, false);
    if (packet.reset || packet.expansion?.barriers) {
      this.barrierViews.clear();
      for (const wall of this.latest.expansion?.barriers ?? []) this.barrierViews.set(wall.id, { ...wall, tiles: [...wall.tiles] });
      this.projectedBarriers = undefined;
    }
    if (packet.barrierChanges) {
      if (packet.barrierChanges.reset) this.barrierViews.clear();
      for (const id of packet.barrierChanges.removed) this.barrierViews.delete(id);
      for (const wall of packet.barrierChanges.rows) this.barrierViews.set(wall.id, { ...wall, tiles: [...wall.tiles] });
      for (const state of packet.barrierChanges.states ?? []) this.barrierViews.set(state.id, { ...this.barrierViews.get(state.id)!, ...state });
      this.projectedBarriers = undefined;
    }
    if (packet.reset || packet.expansion?.deposits || packet.expansion?.depositOwners?.length)
      this.depositRevision++;
  }
  presentation(): { snapshot: Snapshot; canonicalSequence: number } {
    return this.project(false);
  }
  /** Only for immediate synchronous postMessage. Its structured clone isolates
   * recipients. Roads are replaced, never mutated by the decoder; deposit
   * views are replaced on an explicit baseline/ownership revision. Barrier
   * records are replaced through complete deltas while their immutable geometry
   * is retained. None of these
   * fact buffer may be transferred, mutated or retained by the sender. */
  presentationForTransfer(): { snapshot: Snapshot; canonicalSequence: number } {
    return this.project(true);
  }
  /** Packed, packet-owned presentation. Tile obligations are fenced by the
   * presentation ACK, not an encoder cursor, so dropped views cannot lose dirt.
   * Full entity rows make any latest-only view independently applicable. */
  presentationPacket(): { viewPacket: SnapshotPacket; canonicalSequence: number } {
    if (!this.latest) throw new Error("Canonical state is unavailable");
    const source = this.latest, reset = this.resetSequence > this.presented;
    const tiles: number[] = [];
    const append = (tile: number) => {
      const value = source.owners[tile] | (source.claims[tile] << 8) | (source.progress[tile] << 16);
      if (!reset || value !== 0) tiles.push(tile, value);
    };
    if (reset) for (let tile = 0; tile < source.owners.length; tile++) append(tile);
    else for (const tile of this.dirty.keys()) append(tile);
    // Each view is independently complete. Encoder cursors must never fence
    // changes against a projected view that the main thread might discard.
    const viewPacket = new SnapshotEncoder(true).encode(source, undefined, undefined,
      { tiles: new Uint32Array(tiles), reset,
        roadsChanged: reset || source.expansion?.roadRevision !== this.acknowledgedRoadRevision,
        resourcesChanged: reset || this.depositRevision !== this.acknowledgedDepositRevision });
    viewPacket.entityMode = "full";
    if (!reset && viewPacket.expansion) {
      if (source.expansion?.roadRevision === this.acknowledgedRoadRevision) delete viewPacket.expansion.roads;
      if (this.depositRevision === this.acknowledgedDepositRevision) {
        delete viewPacket.expansion.deposits;
        delete viewPacket.expansion.depositOwners;
      }
    }
    this.pendingGeometry.set(this.sequence, { roads: source.expansion?.roadRevision ?? -1, deposits: this.depositRevision });
    // Retained views are bounded like the online transport's presentation queue.
    if (this.pendingGeometry.size > 4) this.pendingGeometry.delete(this.pendingGeometry.keys().next().value!);
    return { viewPacket, canonicalSequence: this.sequence };
  }
  private project(forTransfer: boolean): { snapshot: Snapshot; canonicalSequence: number } {
    if (!this.latest) throw new Error("Canonical state is unavailable");
    const expansion = this.latest.expansion;
    const snapshot = structuredClone(forTransfer && expansion
      ? { ...this.latest, expansion: { ...expansion, roads: undefined, deposits: undefined, barriers: undefined } }
      : this.latest) as Snapshot;
    if (forTransfer && expansion) {
      if (this.projectedDepositRevision !== this.depositRevision) {
        this.projectedDeposits = expansion.deposits.map(deposit => ({ ...deposit }));
        this.projectedDepositRevision = this.depositRevision;
      }
      snapshot.expansion!.roads = expansion.roads;
      snapshot.expansion!.deposits = this.projectedDeposits;
      snapshot.expansion!.barriers = this.projectedBarriers ??= [...this.barrierViews.values()];
    }
    snapshot.changedTiles =
      this.resetSequence > this.presented
        ? undefined
        : new Uint32Array([...this.dirty.keys()]);
    return { snapshot, canonicalSequence: this.sequence };
  }
  acknowledge(sequence: number): void {
    if (sequence <= this.presented || sequence > this.sequence) return;
    this.presented = sequence;
    const geometry = this.pendingGeometry.get(sequence);
    if (geometry) {
      this.acknowledgedRoadRevision = geometry.roads;
      this.acknowledgedDepositRevision = geometry.deposits;
    }
    for (const key of this.pendingGeometry.keys()) if (key <= sequence) this.pendingGeometry.delete(key);
    for (const [tile, changed] of this.dirty)
      if (changed <= sequence) this.dirty.delete(tile);
  }
}
