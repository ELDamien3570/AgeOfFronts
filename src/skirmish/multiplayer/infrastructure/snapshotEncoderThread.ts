import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import type { SnapshotPacket } from "../../Protocol";
import { encodeState } from "../StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../StateLimits";
import { RuntimeDiagnostics } from "../../RuntimeDiagnostics";
import { observeGarbageCollection } from "./WorkerRuntimeDiagnostics";

if (!parentPort) throw new Error("Snapshot encoding requires a worker");
/** N6b (P14): when present, streamed publications go straight to the
 * coordinator on this port instead of hopping through the simulation thread. */
const publicationPort = (workerData as { publicationPort?: MessagePort } | undefined)?.publicationPort;
let pending = Promise.resolve();
// Publications are delta-chained: after one fails, no later one may be sent.
let publicationFailure: string | undefined;
const diagnostics = new RuntimeDiagnostics();
const stopObserving = observeGarbageCollection(diagnostics);
parentPort.on("close", stopObserving);
parentPort.on("close", () => publicationPort?.close());
parentPort.on("message", (message: { id: number; packet: SnapshotPacket; publication?: { tick: number; sequence: number } }) => {
  pending = pending.then(async () => {
    try {
      if (message.publication && publicationFailure) throw new Error(publicationFailure);
      const packet = await encodeState(message.packet, diagnostics, SNAPSHOT_STATE_LIMITS, true);
      const { heapUsed, external, arrayBuffers } = process.memoryUsage();
      const report = { id: message.id, tick: message.packet.tick, timings: diagnostics.snapshot(),
        retainedBytes: diagnostics.retainedBytes, memory: { heapUsed, external, arrayBuffers } };
      if (message.publication && publicationPort) {
        publicationPort.postMessage({ publication: { ...message.publication, packet } }, [packet.binary!.buffer]);
        parentPort!.postMessage({ ...report, published: true });
      } else parentPort!.postMessage({ ...report, packet }, [packet.binary!.buffer]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Snapshot encoding failed";
      if (message.publication) publicationFailure ??= text;
      parentPort!.postMessage({ id: message.id, error: text });
    }
  });
});
