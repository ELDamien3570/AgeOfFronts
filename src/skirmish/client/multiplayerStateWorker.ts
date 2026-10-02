import type { SnapshotPacket } from "../Protocol";
import { decodeState, type EncodedState } from "../multiplayer/StateCodec";
import { CanonicalStateStream } from "./CanonicalStateStream";

// Network decompression, hashing and parsing stay off the rendering thread.
// OnlineMatchSession admits one decode at a time and bounds queued states.
const stream = new CanonicalStateStream();
let incoming = Promise.resolve();
self.onmessage = (
  event: MessageEvent<EncodedState | { type: "presented"; sequence: number }>,
) => {
  incoming = incoming.then(async () => {
    if ("type" in event.data) {
      stream.acknowledge(event.data.sequence);
      return;
    }
    try {
      const started = performance.now(),
        packet = await decodeState<SnapshotPacket>(event.data),
        decoded = performance.now();
      stream.apply(packet);
      const applied = performance.now();
      const view = stream.presentation();
      self.postMessage(
        {
          packet: { tick: packet.tick, reset: packet.reset },
          ...view,
          decodeMs: decoded - started,
          applyMs: applied - decoded,
        },
        {
          transfer: [
            view.snapshot.owners.buffer,
            view.snapshot.claims.buffer,
            view.snapshot.progress.buffer,
          ],
        },
      );
    } catch (error) {
      self.postMessage({
        error: error instanceof Error ? error.message : "Invalid match state",
      });
    }
  });
};
