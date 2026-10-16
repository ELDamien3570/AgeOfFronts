import { PerformanceObserver } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { RuntimeDiagnostics } from "../../RuntimeDiagnostics";

/** Operator opt-in for the live-heap export (I-0): set to "1" in the
 * coordinator's environment and every match worker it starts exposes a gc
 * function to itself, so its diagnostics carry liveHeapBytes every 30 s. Off
 * by default because each sample forces a full collection on the simulation
 * thread (owner decision: the pause is not paid unless an operator asks). */
export const LIVE_HEAP_ENV = "SKIRMISH_LIVE_HEAP";
export const liveHeapRequested = (env: NodeJS.ProcessEnv = process.env) => env[LIVE_HEAP_ENV] === "1";
/** A gc function for this thread without --expose-gc on the command line
 * (a Worker's execArgv cannot carry V8 flags). The flag is process-wide but
 * only contexts created after it see `gc`. */
export function exposeGarbageCollector(): (() => void) | undefined {
  const existing = (globalThis as { gc?: unknown }).gc;
  if (typeof existing === "function") return existing as () => void;
  try {
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as unknown;
    return typeof gc === "function" ? gc as () => void : undefined;
  } catch { return undefined; }
}

/** heapUsed straight after a full collection, or undefined when the host
 * exposes no gc function (production default; operators opt in with
 * SKIRMISH_LIVE_HEAP=1 or --expose-gc). A forced collection pauses the thread, so callers sample this
 * only at the slow diagnostic cadence. Live heap without garbage is what the
 * 384 MB old-space cap is measured against (review-notes 22). */
export function liveHeapBytes(gc: unknown = (globalThis as { gc?: unknown }).gc,
  memory: () => { heapUsed: number } = () => process.memoryUsage()): number | undefined {
  if (typeof gc !== "function") return undefined;
  (gc as () => void)();
  return memory().heapUsed;
}

/** Worker-local duration samples. No marks, per-entity histories or process RSS
 * attribution; Node owns pending entries and releases them after delivery. */
export function observeGarbageCollection(diagnostics: RuntimeDiagnostics): () => void {
  const supported = Reflect.get(PerformanceObserver, "supportedEntryTypes") as readonly string[] | undefined;
  if (!diagnostics.enabled || (supported && !supported.includes("gc"))) return () => {};
  const observer = new PerformanceObserver(entries => {
    for (const entry of entries.getEntries()) diagnostics.record("gc", entry.duration);
  });
  observer.observe({ entryTypes: ["gc"] });
  return () => observer.disconnect();
}
