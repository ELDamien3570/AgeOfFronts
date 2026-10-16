import { PerformanceObserver } from "node:perf_hooks";
import type { RuntimeDiagnostics } from "../../RuntimeDiagnostics";

/** heapUsed straight after a full collection, or undefined when the host
 * exposes no gc function (production default; operators opt in with
 * --expose-gc). A forced collection pauses the thread, so callers sample this
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
