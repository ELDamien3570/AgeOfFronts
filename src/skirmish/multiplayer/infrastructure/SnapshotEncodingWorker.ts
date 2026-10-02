import { Worker } from "node:worker_threads";
import type { SnapshotPacket } from "../../Protocol";
import type { EncodedState } from "../StateCodec";

/** Owns pure immutable snapshot encoding, never authoritative game state. */
export class SnapshotEncodingWorker {
  private readonly worker = new Worker(new URL("./snapshotEncoderThread.ts", import.meta.url), {
    execArgv: ["--import", "tsx"], resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  private readonly pending = new Map<number, { resolve: (packet: EncodedState) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  memory?: { heapUsed: number; external: number; arrayBuffers: number };
  private nextId = 1;
  private failure?: Error;
  constructor() {
    this.worker.on("message", (message: { id: number; packet: EncodedState; error?: string; memory?: { heapUsed: number; external: number; arrayBuffers: number } }) => {
      const task = this.pending.get(message.id); if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timeout);
      this.memory = message.memory;
      if (message.error) task.reject(new Error(message.error)); else task.resolve(message.packet);
    });
    this.worker.on("error", error => this.fail(error));
    this.worker.on("exit", code => this.fail(new Error(`Snapshot encoder stopped (exit ${code})`)));
  }
  encode(packet: SnapshotPacket): Promise<EncodedState> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 2) return Promise.reject(new Error("Snapshot encoder backlog exceeded"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.fail(new Error("Snapshot encoder timed out")); void this.worker.terminate(); }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      // Clone synchronously at this tick boundary. Expansion fields can still
      // reference domain records, so never defer postMessage until a later tick.
      // The encoder owns its isolated copy; the simulation may then advance.
      try { this.worker.postMessage({ id, packet }); }
      catch (error) { this.pending.delete(id); clearTimeout(timeout); reject(error as Error); }
    });
  }
  async close(): Promise<void> { this.fail(new Error("Snapshot encoder stopped")); await this.worker.terminate(); }
  private fail(error: Error): void {
    this.failure ??= error;
    for (const task of this.pending.values()) { clearTimeout(task.timeout); task.reject(this.failure); }
    this.pending.clear();
  }
}
