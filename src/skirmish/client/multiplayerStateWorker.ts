import type { SnapshotPacket } from "../Protocol";
import {
  decodeState,
  type EncodedState,
  type StateDecodeStats,
} from "../multiplayer/StateCodec";
import { CanonicalStateStream } from "./CanonicalStateStream";

// Network decompression, hashing and parsing stay off the rendering thread.
// OnlineMatchSession admits one decode at a time and bounds queued states.
let stream: CanonicalStateStream | undefined;
let expectedMap: { width: number; height: number } | undefined;
// SnapshotPacket uses word arrays, not expanded RLE map arrays: a valid
// encoder's aggregate typed output is already below its 64 MB wire ceiling.
const MAX_SNAPSHOT_ARRAY_BYTES = 64_000_000;
let incoming = Promise.resolve();
self.onmessage = (
  event: MessageEvent<
    | (EncodedState & { expectedMap: { width: number; height: number }; presentation?: boolean })
    | { type: "presented"; sequence: number }
    | { type: "presentation" }
  >,
) => {
  incoming = incoming.then(async () => {
    if ("type" in event.data) {
      if (event.data.type === "presented") stream?.acknowledge(event.data.sequence);
      else {
        try {
          if (!stream) throw new Error("Canonical state is unavailable");
          const projectionStarted = performance.now();
          const view = stream.presentation();
          const projected = performance.now();
          self.postMessage({ packet: { tick: view.snapshot.tick, reset: view.snapshot.changedTiles === undefined }, ...view,
            projectionMs: projected - projectionStarted },
            { transfer: [view.snapshot.owners.buffer, view.snapshot.claims.buffer, view.snapshot.progress.buffer] });
        } catch (error) {
          self.postMessage({ error: error instanceof Error ? error.message : "Invalid presentation request" });
        }
      }
      return;
    }
    try {
      const dimensions = event.data.expectedMap;
      if (
        !dimensions ||
        !Number.isSafeInteger(dimensions.width) ||
        dimensions.width <= 0 ||
        !Number.isSafeInteger(dimensions.height) ||
        dimensions.height <= 0 ||
        !Number.isSafeInteger(dimensions.width * dimensions.height) ||
        dimensions.width * dimensions.height > 64_000_000
      )
        throw new Error("Invalid loaded map dimensions");
      if (
        expectedMap &&
        (expectedMap.width !== dimensions.width ||
          expectedMap.height !== dimensions.height)
      )
        throw new Error("Loaded map dimensions changed");
      if (!stream) {
        expectedMap = { ...dimensions };
        stream = new CanonicalStateStream(
          dimensions.width * dimensions.height,
          65_536,
          expectedMap,
        );
      }
      let decodeStats: StateDecodeStats | undefined;
      const started = performance.now(),
        packet = await decodeState<SnapshotPacket>(event.data, {
          maxArrayBytes: MAX_SNAPSHOT_ARRAY_BYTES,
          onDecoded: (stats) => {
            decodeStats = stats;
          },
        }),
        decoded = performance.now();
      stream.apply(packet);
      const applied = performance.now();
      if (event.data.presentation === false) {
        // Canonical application and network credit continue while rendering is
        // busy; no throwaway complete snapshot is cloned or transferred.
        self.postMessage({ packet: { tick: packet.tick, reset: packet.reset }, canonicalOnly: true,
          decodeMs: decoded - started, applyMs: applied - decoded, decodeStats });
        return;
      }
      const view = stream.presentation();
      const projected = performance.now();
      self.postMessage(
        {
          packet: { tick: packet.tick, reset: packet.reset },
          ...view,
          decodeMs: decoded - started,
          applyMs: applied - decoded,
          projectionMs: projected - applied,
          decodeStats,
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
