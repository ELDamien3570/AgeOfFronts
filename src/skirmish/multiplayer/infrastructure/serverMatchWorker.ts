import { parentPort } from "node:worker_threads";
import { createSkirmishMap } from "../../Elevation";
import { SpawnSelection } from "../../domain/SpawnSelection";
import { CommitVerifier } from "../application/CommitVerifier";
import type { RuntimeMap } from "../application/HostedRuntime";
import { HostedRuntime } from "../application/HostedRuntime";
import { mapIdentity } from "../application/MapIdentity";
import type { ExecutorRequest } from "../application/MatchExecutor";
import { loadServerMap } from "./ServerMap";

if (!parentPort) throw new Error("The match executor requires a worker thread");
let verifier: CommitVerifier | undefined;
let identity: string;
let setup: SpawnSelection | undefined;
let preparedMap: RuntimeMap | undefined;
let pending = Promise.resolve();
parentPort.on(
  "message",
  (message: { id: number; request: ExecutorRequest }) => {
    pending = pending.then(async () => {
      try {
        const request = message.request;
        let result: unknown;
        if (request.type === "initialize" || request.type === "prepare") {
          if (verifier || setup)
            throw new Error("Executor already initialized");
          const loaded = request.map
            ? {
                map: request.map,
                territoryIncomeScale: request.options.territoryIncomeScale,
              }
            : await loadServerMap(request.settings);
          const options = {
            ...request.options,
            territoryIncomeScale: loaded.territoryIncomeScale,
          };
          identity = await mapIdentity(loaded.map);
          if (request.type === "prepare") {
            preparedMap = loaded.map;
            setup = new SpawnSelection(
              createSkirmishMap(
                loaded.map.width,
                loaded.map.height,
                loaded.map.terrain,
                loaded.map.elevation,
                loaded.map.forest,
                loaded.map.resourceTerrain,
              ),
              options,
            );
            setup.resolve();
            result = { mapHash: identity, options };
          } else {
            verifier = new CommitVerifier(
              new HostedRuntime(loaded.map, {
                ...request.options,
                territoryIncomeScale: loaded.territoryIncomeScale,
              }),
            );
            identity = await mapIdentity(loaded.map);
            result = await verifier.initial();
          }
        } else if (
          request.type === "select-spawn" ||
          request.type === "spawn-state" ||
          request.type === "start"
        ) {
          if (!setup || !preparedMap)
            throw new Error("Spawn selection has closed");
          if (request.type === "select-spawn")
            result = {
              rejection: setup.select(request.playerId, request.tile),
              state: setup.state(0),
            };
          else if (request.type === "spawn-state")
            result = setup.state(request.remainingMs);
          else {
            verifier = new CommitVerifier(
              new HostedRuntime(preparedMap, {
                ...setup.options,
                humanSpawns: setup.choices,
              }),
            );
            result = await verifier.initial();
            setup = undefined;
            preparedMap = undefined;
          }
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
