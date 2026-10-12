import type { Snapshot, SnapshotPacket } from "../Protocol";
import { SnapshotDecoder } from "../SnapshotCodec";

/** A rejected delta invalidates stream continuity, including geometry journals.
 * Resume only at a complete worker baseline; never apply subsequent deltas to
 * the last accepted state or retry a malformed baseline indefinitely. */
export class LocalSnapshotStream {
  private readonly decoder = new SnapshotDecoder();
  private recovering = false;
  constructor(private readonly requestBaseline: (error: unknown) => void) {}

  decode(packet: SnapshotPacket): Snapshot | undefined {
    if (this.recovering && !packet.reset) return undefined;
    try {
      const snapshot = this.decoder.decodeLatest(packet);
      this.recovering = false;
      return snapshot;
    } catch (error) {
      if (packet.reset) throw error;
      this.recovering = true;
      this.requestBaseline(error);
      return undefined;
    }
  }
}
