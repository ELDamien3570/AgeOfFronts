import type { Snapshot, SnapshotPacket } from "../Protocol";
import { SnapshotDecoder } from "../SnapshotCodec";

/** Worker-owned canonical state. Network deltas are never presentation frames. */
export class CanonicalStateStream {
  private readonly decoder = new SnapshotDecoder();
  private latest?: Snapshot;
  private sequence = 0;
  private presented = 0;
  private resetSequence = 0;
  private readonly dirty = new Map<number, number>();
  apply(packet: SnapshotPacket): void {
    if (!this.latest && !packet.reset)
      throw new Error("A canonical stream needs a baseline before deltas");
    if (this.latest && packet.tick < this.latest.tick)
      throw new Error("Canonical updates arrived out of order");
    this.sequence++;
    if (packet.reset) {
      this.dirty.clear();
      this.resetSequence = this.sequence;
    }
    for (let at = 0; at < packet.tiles.length; at += 2)
      this.dirty.set(packet.tiles[at], this.sequence);
    this.latest = this.decoder.decode(packet, false);
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
