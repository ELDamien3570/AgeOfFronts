import {
  HostedRuntime,
  type HostBatch,
  type RuntimeMap,
} from "../multiplayer/application/HostedRuntime";
import { decodeState, type EncodedState } from "../multiplayer/StateCodec";
import type { MatchOptions } from "../Protocol";
import type { Skirmish } from "../Simulation";
let runtime: HostedRuntime;
let queue = Promise.resolve();
self.onmessage = (event) => {
  queue = queue.then(async () => {
    const { id, type } = event.data;
    try {
      let result: unknown;
      if (type === "initialize") {
        runtime = new HostedRuntime(
          event.data.map as RuntimeMap,
          event.data.options as MatchOptions,
        );
        const saved = runtime.match.checkpoint();
        const timings: number[] = [];
        for (let i = 0; i < 12; i++) {
          const start = performance.now();
          runtime.match.step();
          timings.push(performance.now() - start);
        }
        runtime.restore(saved);
        timings.sort((a, b) => a - b);
        result = timings[timings.length - 1];
      } else if (type === "restore") {
        const saved = await decodeState<ReturnType<Skirmish["checkpoint"]>>(
          event.data.checkpoint as EncodedState,
        );
        runtime.restore(saved, event.data.stateId as string);
        result = runtime.match.tick;
      } else if (type === "batch")
        result = await runtime.run(event.data.batch as HostBatch);
      else throw new Error("Unknown host operation");
      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({ id, error: (error as Error).message });
    }
  });
};
