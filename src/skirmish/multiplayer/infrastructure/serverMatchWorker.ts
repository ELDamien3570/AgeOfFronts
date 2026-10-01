import { parentPort } from "node:worker_threads";
import { CommitVerifier } from "../application/CommitVerifier";
import { HostedRuntime } from "../application/HostedRuntime";
import { mapIdentity } from "../application/MapIdentity";
import type { ExecutorRequest } from "../application/MatchExecutor";
import { loadServerMap } from "./ServerMap";

if (!parentPort) throw new Error("The match executor requires a worker thread");
let verifier: CommitVerifier | undefined;
let identity: string;
let pending = Promise.resolve();
parentPort.on(
  "message",
  (message: { id: number; request: ExecutorRequest }) => {
    pending = pending.then(async () => {
      try {
        const request = message.request;
        let result: unknown;
        if (request.type === "initialize") {
          if (verifier) throw new Error("Executor already initialized");
          const loaded = request.map
            ? {
                map: request.map,
                territoryIncomeScale: request.options.territoryIncomeScale,
              }
            : await loadServerMap(request.settings);
          verifier = new CommitVerifier(
            new HostedRuntime(loaded.map, {
              ...request.options,
              territoryIncomeScale: loaded.territoryIncomeScale,
            }),
          );
          identity = await mapIdentity(loaded.map);
          result = await verifier.initial();
        } else {
          if (!verifier) throw new Error("Executor not initialized");
          switch (request.type) {
            case "map-identity":
              result = identity;
              break;
            case "restore":
              await verifier.restore(request.checkpoint, request.ledger);
              break;
            case "verify":
              result = await verifier.verify(request.batch, request.proposal);
              break;
            case "accept":
              result = await verifier.accept(request.commit);
              break;
            case "baseline":
              result = await verifier.baseline();
              break;
            case "checkpoint":
              result = await verifier.checkpoint();
              break;
            case "fallback":
              result = await verifier.fallback(request.batch);
              break;
          }
        }
        parentPort!.postMessage({ id: message.id, result });
      } catch (error) {
        parentPort!.postMessage({
          id: message.id,
          error:
            error instanceof Error ? error.message : "Match executor failed",
        });
      }
    });
  },
);
