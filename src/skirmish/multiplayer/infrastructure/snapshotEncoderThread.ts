import { parentPort } from "node:worker_threads";
import type { SnapshotPacket } from "../../Protocol";
import { encodeState } from "../StateCodec";

if (!parentPort) throw new Error("Snapshot encoding requires a worker");
let pending = Promise.resolve();
parentPort.on("message", (message: { id: number; packet: SnapshotPacket }) => {
  pending = pending.then(async () => {
    try {
      const packet = await encodeState(message.packet);
      const { heapUsed, external, arrayBuffers } = process.memoryUsage();
      parentPort!.postMessage({ id: message.id, packet, memory: { heapUsed, external, arrayBuffers } });
    } catch (error) {
      parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : "Snapshot encoding failed" });
    }
  });
});
