import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MessageChannel, Worker } from "node:worker_threads";
import { PublicationSequencer } from "../application/PublicationSequencer";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
  MatchPublication,
} from "../application/MatchExecutor";
import { RequestDeadlines, requestTimeoutMs } from "./RequestDeadlines";
import { liveHeapRequested } from "./WorkerRuntimeDiagnostics";
import { prepareAttemptSeeds } from "../application/PreparePlan";

const workerPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "serverMatchWorker.ts",
);

/** Empty listings never construct this adapter. Each admitted match owns one reserved worker. */
export class ReservedMatchWorker implements MatchExecutor {
  /** N6b (P14): the encoder thread publishes straight to this port. */
  private readonly channel = new MessageChannel();
  private readonly worker = new Worker(
    workerPath,
    {
      execArgv: ["--import", "tsx"],
      resourceLimits: { maxOldGenerationSizeMb: 384 },
      workerData: { publicationPort: this.channel.port2, liveHeap: liveHeapRequested() },
      transferList: [this.channel.port2],
    },
  );
  private readonly sequencer = new PublicationSequencer<MatchPublication, { id: number; result: ExecutorResult; error?: string }>(
    publication => { if (!this.closed) for (const listener of this.publications) listener(publication); },
    message => this.settle(message),
  );
  private readonly publications = new Set<(publication: MatchPublication) => void>();
  onPublication(listener: (publication: MatchPublication) => void): () => void {
    this.publications.add(listener); return () => this.publications.delete(listener);
  }
  private nextId = 1;
  private closed = false;
  readonly lifecycle: { state: "running" | "stopped"; cause?: "closed" | "error" | "exit" | "timeout" | "publication" | "recovery"; operation?: string; exitCode?: number } = { state: "running" };
  private pending = new Map<
    number,
    {
      resolve: (value: ExecutorResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private publication(publication: MatchPublication & { sequence?: number }): void {
    try { this.sequencer.publication(publication.sequence ?? this.sequencer.deliveredPublications + 1, publication); }
    catch (error) { this.fail(error as Error, "publication"); void this.worker.terminate(); }
  }
  private settle(message: { id: number; result: ExecutorResult; error?: string }): void {
    const task = this.pending.get(message.id);
    if (!task) return;
    this.pending.delete(message.id);
    this.deadlines.settle(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.result);
  }
  /** Only the request the worker is processing runs a timer; queued ones start theirs when reached. */
  private readonly deadlines = new RequestDeadlines<ExecutorRequest>((_id, request) => {
    this.lifecycle.operation = request.type;
    // The worker never gets to log a prepare it did not finish, so name the
    // seeds here. The worker logs each failed attempt (map-prepare-failed);
    // the attempt in progress used one of these seeds, in order.
    if (request.type === "prepare")
      console.error(JSON.stringify({ event: "map-prepare-timeout", mapId: request.settings.mapId,
        size: request.settings.worldSize, seed: request.options.seed, attemptSeeds: prepareAttemptSeeds(request.options.seed) }));
    this.fail(new Error(`Match executor timed out during ${request.type}`), "timeout");
    void this.worker.terminate();
  });
  constructor() {
    this.channel.port1.on("message", (message: { publication?: MatchPublication & { sequence: number } }) => {
      if (message.publication) this.publication(message.publication);
    });
    this.worker.on(
      "message",
      (message: { id: number; result: ExecutorResult; error?: string; fatal?: string; failureCause?: "recovery"; publication?: MatchPublication & { sequence?: number }; publicationsIssued?: number }) => {
        if (message.fatal) { this.fail(new Error(message.fatal), message.failureCause ?? "publication"); void this.worker.terminate(); return; }
        if (message.publication) { this.publication(message.publication); return; }
        // A result never overtakes a publication issued before it (join
        // barriers and baselines continue the same delta chain).
        this.sequencer.result(message.publicationsIssued ?? 0, message);
      },
    );
    this.worker.on("error", (error) => this.fail(error, "error"));
    this.worker.on("exit", (code) =>
      { this.lifecycle.exitCode = code; this.fail(new Error(`Match executor stopped (exit ${code})`), "exit"); },
    );
  }
  request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Match executor stopped"));
    if (this.pending.size >= 8)
      return Promise.reject(new Error("Match executor backlog exceeded"));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.deadlines.enqueue(id, requestTimeoutMs(request.type), request);
      this.worker.postMessage({ id, request });
    });
  }
  async close(): Promise<void> {
    this.fail(new Error("Match executor stopped"), "closed");
    await this.worker.terminate();
  }
  private fail(error: Error, cause: NonNullable<ReservedMatchWorker["lifecycle"]["cause"]>): void {
    this.lifecycle.cause ??= cause;
    this.lifecycle.state = "stopped";
    this.closed = true;
    this.sequencer.stop();
    this.channel.port1.close();
    this.deadlines.clear();
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
    this.publications.clear();
  }
}
