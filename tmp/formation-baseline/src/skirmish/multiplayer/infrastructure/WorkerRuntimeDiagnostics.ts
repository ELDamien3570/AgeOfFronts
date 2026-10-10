import { PerformanceObserver } from "node:perf_hooks";
import type { RuntimeDiagnostics } from "../../RuntimeDiagnostics";

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
