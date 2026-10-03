import { parentPort } from "node:worker_threads";
import type { SnapshotPacket } from "../../Protocol";
import { encodeState } from "../StateCodec";
import { SNAPSHOT_STATE_LIMITS } from "../StateLimits";
import { RuntimeDiagnostics } from "../../RuntimeDiagnostics";
import { observeGarbageCollection } from "./WorkerRuntimeDiagnostics";

if (!parentPort) throw new Error("Snapshot encoding requires a worker");
let pending = Promise.resolve();
const diagnostics = new RuntimeDiagnostics();
const stopObserving = observeGarbageCollection(diagnostics);
parentPort.on("close", stopObserving);
parentPort.on("message", (message: { id: number; packet: SnapshotPacket }) => {
  pending = pending.then(async () => {
    try {
      const packet = await encodeState(message.packet, diagnostics, SNAPSHOT_STATE_LIMITS);
      const { heapUsed, external, arrayBuffers } = process.memoryUsage();
      parentPort!.postMessage({ id: message.id, packet, tick: message.packet.tick, timings: diagnostics.snapshot(),
        retainedBytes: diagnostics.retainedBytes, memory: { heapUsed, external, arrayBuffers } });
    } catch (error) {
      parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : "Snapshot encoding failed" });
    }
  });
});
