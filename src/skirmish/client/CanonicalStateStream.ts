import type { Snapshot, SnapshotPacket } from "../Protocol";
import { MAX_QUEUED_ORDERS, MAX_SQUADS } from "../Protocol";
import { SNAPSHOT_LAYOUT, SnapshotDecoder } from "../SnapshotCodec";
const {
  squadStride: SQUAD_STRIDE,
  orderStride: ORDER_STRIDE,
  buildingStride: BUILDING_STRIDE,
} = SNAPSHOT_LAYOUT;

/** Worker-owned canonical state. Network deltas are never presentation frames. */
export class CanonicalStateStream {
  private readonly decoder = new SnapshotDecoder();
  private latest?: Snapshot;
  private sequence = 0;
  private presented = 0;
  private resetSequence = 0;
  private readonly dirty = new Map<number, number>();
  constructor(
    private readonly maxMapCells = 64_000_000,
    private readonly maxDirtyTiles = 65_536,
    private readonly expectedMap?: { width: number; height: number },
  ) {}
  apply(packet: SnapshotPacket): void {
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
  }
  presentation(): { snapshot: Snapshot; canonicalSequence: number } {
    if (!this.latest) throw new Error("Canonical state is unavailable");
    const snapshot = structuredClone(this.latest);
    snapshot.changedTiles =
      this.resetSequence > this.presented
        ? undefined
        : new Uint32Array([...this.dirty.keys()]);
    return { snapshot, canonicalSequence: this.sequence };
  }
  acknowledge(sequence: number): void {
    if (sequence <= this.presented || sequence > this.sequence) return;
    this.presented = sequence;
    for (const [tile, changed] of this.dirty)
      if (changed <= sequence) this.dirty.delete(tile);
  }
}
