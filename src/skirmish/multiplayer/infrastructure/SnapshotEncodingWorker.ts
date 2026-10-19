import { Worker, type MessagePort } from "node:worker_threads";
import type { SnapshotPacket } from "../../Protocol";
import type { EncodedState } from "../StateCodec";
import { RuntimeDiagnostics, type RuntimePhase, type TimingSummary } from "../../RuntimeDiagnostics";
import { snapshotTransfers } from "../../SnapshotCodec";
import { workerEntry } from "./WorkerEntry";

/** Owns pure immutable snapshot encoding, never authoritative game state. */
export class SnapshotEncodingWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (packet: EncodedState | undefined) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  memory?: { heapUsed: number; external: number; arrayBuffers: number };
  timings?: Partial<Record<RuntimePhase, TimingSummary>>;
  readonly diagnostics = new RuntimeDiagnostics();
  retainedBytes = 0;
  encodedTick?: number;
  failureCause?: "timeout" | "exit" | "error" | "closed";
  /** The worker 'error' event's code, e.g. ERR_WORKER_OUT_OF_MEMORY. */
  failureCode?: string;
  private nextId = 1;
  private failure?: Error;
  /** With `publicationPort`, encode(packet, publication) posts the encoded
   * publication on that port (N6b) and resolves without a packet. */
  constructor(readonly publicationPort?: MessagePort) {
    const entry = workerEntry("snapshotEncoderThread", import.meta.url);
    this.worker = new Worker(entry.url, {
      execArgv: entry.execArgv, resourceLimits: { maxOldGenerationSizeMb: 256 },
      ...(publicationPort ? { workerData: { publicationPort }, transferList: [publicationPort] } : {}),
    });
    this.worker.on("message", (message: { id: number; packet?: EncodedState; tick?: number; error?: string; timings?: Partial<Record<RuntimePhase, TimingSummary>>; retainedBytes?: number; memory?: { heapUsed: number; external: number; arrayBuffers: number } }) => {
      const task = this.pending.get(message.id); if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timeout);
      this.memory = message.memory;
      this.timings = message.timings;
      this.encodedTick = message.tick;
      this.retainedBytes = message.retainedBytes ?? 0;
      if (message.error) task.reject(new Error(message.error)); else task.resolve(message.packet);
    });
    this.worker.on("error", error => {
      this.failureCode ??= (error as NodeJS.ErrnoException).code;
      this.fail(error, "error");
    });
    this.worker.on("exit", code => {
      if (this.failureCause !== "closed")
        console.error(JSON.stringify({ event: "snapshot-encoder-exited", exitCode: code, cause: this.failureCause ?? "exit",
          ...(this.failureCode ? { errorCode: this.failureCode } : {}), ...(this.failure ? { errorMessage: this.failure.message } : {}) }));
      this.fail(new Error(`Snapshot encoder stopped (exit ${code})`), "exit");
    });
  }
  encode(packet: SnapshotPacket): Promise<EncodedState>;
  encode(packet: SnapshotPacket, publication: { tick: number; sequence: number }): Promise<undefined>;
  encode(packet: SnapshotPacket, publication?: { tick: number; sequence: number }): Promise<EncodedState | undefined> {
    if (publication && !this.publicationPort) return Promise.reject(new Error("Snapshot encoder has no publication port"));
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 2) return Promise.reject(new Error("Snapshot encoder backlog exceeded"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => { this.fail(new Error("Snapshot encoder timed out"), "timeout"); void this.worker.terminate(); }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      // Clone synchronously at this tick boundary. Expansion fields can still
      // reference domain records, so never defer postMessage until a later tick.
      // The encoder owns its isolated copy; the simulation may then advance.
      try { this.diagnostics.measure("transfer", () => this.worker.postMessage({ id, packet, ...(publication ? { publication } : {}) }, snapshotTransfers(packet))); }
      catch (error) { this.pending.delete(id); clearTimeout(timeout); reject(error as Error); }
    });
  }
  async close(): Promise<void> { this.fail(new Error("Snapshot encoder stopped"), "closed"); await this.worker.terminate(); }
  private fail(error: Error, cause: NonNullable<SnapshotEncodingWorker["failureCause"]>): void {
    this.failureCause ??= cause;
    this.failure ??= error;
    for (const task of this.pending.values()) { clearTimeout(task.timeout); task.reject(this.failure); }
    this.pending.clear();
  }
}
