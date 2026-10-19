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
import { workerEntry } from "./WorkerEntry";

/** Operator opt-in for rollback containment (Next #10): set to "1" in the
 * coordinator's environment and every match worker it starts holds a
 * checkpoint every CHECKPOINT_INTERVAL_TICKS and rolls a faulting advance back.
 * Off by default (owner decision): a checkpoint costs about one tick's budget
 * on Med 500 with 8 humans, so a fault ends the match cleanly instead until
 * the checkpoint is incremental or off-thread. */
export const ROLLBACK_ENV = "SKIRMISH_ROLLBACK";
export const rollbackRequested = (env: NodeJS.ProcessEnv = process.env) => env[ROLLBACK_ENV] === "1";
import { prepareAttemptSeeds } from "../application/PreparePlan";

const matchWorker = workerEntry("serverMatchWorker", import.meta.url);

/** Empty listings never construct this adapter. Each admitted match owns one reserved worker. */
export class ReservedMatchWorker implements MatchExecutor {
  /** N6b (P14): the encoder thread publishes straight to this port. */
  private readonly channel = new MessageChannel();
  private readonly worker: Worker;
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
  readonly lifecycle: { state: "running" | "stopped"; cause?: "closed" | "error" | "exit" | "timeout" | "publication" | "recovery"; operation?: string; exitCode?: number;
    /** The worker 'error' event's code and message, e.g. ERR_WORKER_OUT_OF_MEMORY. */
    errorCode?: string; errorMessage?: string } = { state: "running" };
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
  /** Tests only: `testFaultTick` makes the worker's simulation throw once
   * when it steps from that tick (the real rollback path);
   * `testPrepareFailures` makes the first N map generations throw (the real
   * prepare retry). `rollback` overrides SKIRMISH_ROLLBACK. */
  constructor(options: { testFaultTick?: number; testPrepareFailures?: number; rollback?: boolean } = {}) {
    this.worker = new Worker(
      matchWorker.url,
      {
        execArgv: matchWorker.execArgv,
        resourceLimits: { maxOldGenerationSizeMb: 384 },
        workerData: { publicationPort: this.channel.port2, liveHeap: liveHeapRequested(),
          rollback: options.rollback ?? rollbackRequested(),
          ...(options.testFaultTick === undefined ? {} : { testFaultTick: options.testFaultTick }),
          ...(options.testPrepareFailures === undefined ? {} : { testPrepareFailures: options.testPrepareFailures }) },
        transferList: [this.channel.port2],
      },
    );
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
    this.worker.on("error", (error) => {
      this.lifecycle.errorCode ??= (error as NodeJS.ErrnoException).code;
      this.lifecycle.errorMessage ??= error.message;
      this.fail(error, "error");
    });
    this.worker.on("exit", (code) => {
      this.lifecycle.exitCode = code;
      // An exit after close() is the requested stop; anything else is logged
      // once with its cause, so an out-of-memory termination is identifiable.
      if (this.lifecycle.cause !== "closed")
        console.error(JSON.stringify({ event: "match-executor-exited", ...this.lifecycle, state: undefined }));
      this.fail(new Error(`Match executor stopped (exit ${code})`), "exit");
    });
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
