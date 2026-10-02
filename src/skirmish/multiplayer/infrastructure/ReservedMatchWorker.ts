import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
  MatchPublication,
} from "../application/MatchExecutor";

const workerPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "serverMatchWorker.ts",
);

/** Empty listings never construct this adapter. Each admitted match owns one reserved worker. */
export class ReservedMatchWorker implements MatchExecutor {
  private readonly worker = new Worker(
    workerPath,
    {
      execArgv: ["--import", "tsx"],
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    },
  );
  private readonly publications = new Set<(publication: MatchPublication) => void>();
  onPublication(listener: (publication: MatchPublication) => void): () => void {
    this.publications.add(listener); return () => this.publications.delete(listener);
  }
  private nextId = 1;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: ExecutorResult) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    this.worker.on(
      "message",
      (message: { id: number; result: ExecutorResult; error?: string; fatal?: string; publication?: MatchPublication }) => {
        if (message.fatal) { this.fail(new Error(message.fatal)); void this.worker.terminate(); return; }
        if (message.publication) {
          if (!this.closed) for (const listener of this.publications) listener(message.publication);
          return;
        }
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        clearTimeout(task.timeout);
        if (message.error) task.reject(new Error(message.error));
        else task.resolve(message.result);
      },
    );
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", (code) =>
      this.fail(new Error(`Match executor stopped (exit ${code})`)),
    );
  }
  request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Match executor stopped"));
    if (this.pending.size >= 8)
      return Promise.reject(new Error("Match executor backlog exceeded"));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.fail(new Error(`Match executor timed out during ${request.type}`));
        void this.worker.terminate();
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.worker.postMessage({ id, request });
    });
  }
  async close(): Promise<void> {
    this.fail(new Error("Match executor stopped"));
    await this.worker.terminate();
  }
  private fail(error: Error): void {
    this.closed = true;
    for (const task of this.pending.values()) {
      clearTimeout(task.timeout);
      task.reject(error);
    }
    this.pending.clear();
    this.publications.clear();
  }
}
