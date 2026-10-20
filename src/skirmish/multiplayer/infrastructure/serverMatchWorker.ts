import { threadCpuClock } from "../../RuntimeDiagnostics";
import { parentPort, threadId, workerData, type MessagePort } from "node:worker_threads";
import type { ExecutorRequest } from "../application/MatchExecutor";
import { createMatchRuntime } from "../application/MatchRuntime";
import { SnapshotEncodingWorker } from "./SnapshotEncodingWorker";
import { loadServerMap } from "./ServerMap";
import { exposeGarbageCollector, liveHeapBytes, observeGarbageCollection } from "./WorkerRuntimeDiagnostics";

if (!parentPort) throw new Error("The match executor requires a worker thread");
const data = workerData as {
  publicationPort?: MessagePort;
  liveHeap?: boolean;
  rollback?: boolean;
  testFaultTick?: number;
  testPrepareFailures?: number;
} | undefined;
/** N6b (P14): the coordinator's end of a MessageChannel. Streamed
 * publications travel encoder thread -> coordinator without waiting for this
 * thread to yield. Every result carries publicationsIssued so the coordinator
 * applies it only after the publications it follows. */
const publicationPort = data?.publicationPort;
// I-0 live heap: only when the operator opted in (SKIRMISH_LIVE_HEAP=1), since
// each 30 s sample forces a full collection on this thread.
const collectGarbage = data?.liveHeap
  ? exposeGarbageCollector() : (globalThis as { gc?: () => void }).gc;
const port = parentPort;
const runtime = createMatchRuntime({
  post: (message) => port.postMessage(message),
  encoder: new SnapshotEncodingWorker(publicationPort),
  directPublications: Boolean(publicationPort),
  loadMap: (settings, seed) => loadServerMap(settings, undefined, seed),
  memory: () => process.memoryUsage(),
  cpuClock: threadCpuClock,
  liveHeap: () => liveHeapBytes(collectGarbage),
  observeGarbageCollection,
  source: process.env.GIT_COMMIT ?? "unknown",
  runtime: process.version,
  threadId,
  rollback: data?.rollback === true,
  testFaultTick: data?.testFaultTick,
  testPrepareFailures: data?.testPrepareFailures,
});
port.on("close", () => runtime.close());
port.on("message", (message: { id: number; request: ExecutorRequest }) => runtime.handle(message));
