import { RuntimeDiagnostics } from "../../RuntimeDiagnostics";
import type { SnapshotPacket } from "../../Protocol";
import { encodeState, type EncodedState } from "../StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../StateLimits";
import type { RuntimeEncoder } from "./MatchRuntime";

/** Encodes on the simulation thread (a hosting browser). encodeState reads the
 * whole packet synchronously before its first await, so the world may keep
 * advancing while the bytes compress. */
export class InlineSnapshotEncoder implements RuntimeEncoder {
  readonly diagnostics = new RuntimeDiagnostics();
  retainedBytes = 0;
  encode(packet: SnapshotPacket): Promise<EncodedState>;
  encode(packet: SnapshotPacket, publication: { tick: number; sequence: number }): Promise<undefined>;
  encode(packet: SnapshotPacket): Promise<EncodedState | undefined> {
    return encodeState(packet, this.diagnostics, SNAPSHOT_STATE_LIMITS, true);
  }
  async close(): Promise<void> {}
}
