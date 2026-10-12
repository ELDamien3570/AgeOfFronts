import type { SnapshotPacket } from "../../../src/skirmish/Protocol";
import { SnapshotDecoder } from "../../../src/skirmish/SnapshotCodec";

const run = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLPreElement>("#result")!;
run.addEventListener("click", () => {
  run.disabled = true;
  const decoder = new SnapshotDecoder(),
    projection: number[] = [];
  const worker = new Worker(
    new URL("./LateGamePerformanceWorker.ts", import.meta.url),
    { type: "module" },
  );
  const baseline = new URLSearchParams(location.search).has("baseline");
  const combined = new URLSearchParams(location.search).has("combined");
  const query = new URLSearchParams(location.search);
  worker.onmessage = ({ data }) => {
    if (data.error) {
      result.textContent = data.error;
      worker.terminate();
      run.disabled = false;
      return;
    }
    if (data.packet) {
      const start = performance.now();
      if (baseline) decoder.decode(data.packet as SnapshotPacket);
      else decoder.decodeLatest(data.packet as SnapshotPacket);
      if (data.measured) projection.push(performance.now() - start);
      worker.postMessage({ type: "next" });
    }
    if (data.progress)
      result.textContent = `Measured ${data.progress}/600 ticks`;
    if (data.result) {
      const sorted = projection.slice().sort((a, b) => a - b);
      result.textContent = JSON.stringify(
        {
          ...data.result,
          projection: {
            mean: projection.reduce((a, b) => a + b, 0) / projection.length,
            p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
            p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
          },
          browser: navigator.userAgent,
          rendering: "excluded",
        },
        null,
        2,
      );
      worker.terminate();
      run.disabled = false;
    }
  };
  worker.onerror = (event) => {
    result.textContent = event.message;
    worker.terminate();
    run.disabled = false;
  };
  result.textContent = "Loading map and checkpoint";
  worker.postMessage({ type: "start", baseline, combined, fixture: query.get("fixture"), pace: query.has("pace") });
});
