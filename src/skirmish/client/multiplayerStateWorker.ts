import type { SnapshotPacket } from "../Protocol";
import { snapshotTransfers } from "../SnapshotCodec";
import { decodeState, type EncodedState } from "../multiplayer/StateCodec";

// Network decompression, hashing and parsing stay off the rendering thread.
// OnlineMatchSession admits one decode at a time and bounds queued states.
self.onmessage = async (event: MessageEvent<EncodedState>) => {
  try {
    const packet = await decodeState<SnapshotPacket>(event.data);
    self.postMessage({ packet }, { transfer: snapshotTransfers(packet) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Invalid match state",
    });
  }
};
