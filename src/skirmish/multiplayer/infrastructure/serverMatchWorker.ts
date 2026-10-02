import { parentPort } from "node:worker_threads";
import { SpawnSelection } from "../../domain/SpawnSelection";
import { createSkirmishMap } from "../../Elevation";
import { Skirmish } from "../../Simulation";
import { SnapshotEncoder } from "../../SnapshotCodec";
import { mapIdentity } from "../application/MapIdentity";
import {
  MAX_ADVANCE_TICKS,
  type ExecutorRequest,
  type MatchAdvance,
  type RuntimeMap,
} from "../application/MatchExecutor";
import { encodeState } from "../StateCodec";
import { loadServerMap } from "./ServerMap";

if (!parentPort) throw new Error("The match executor requires a worker thread");
let match: Skirmish | undefined;
const encoder = new SnapshotEncoder(true);
let setup: SpawnSelection | undefined;
let preparedMap: RuntimeMap | undefined;
let pending = Promise.resolve();
const makeMap = (map: RuntimeMap) =>
  createSkirmishMap(
    map.width,
    map.height,
    map.terrain,
    map.elevation,
    map.forest,
    map.resourceTerrain,
  );
const snapshot = () => encodeState(encoder.encode(match!.snapshot()));
const seats = () =>
  match!.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    ai: p.ai,
    kind: p.kind,
    eliminated: p.eliminated,
  }));

parentPort.on(
  "message",
  (message: { id: number; request: ExecutorRequest }) => {
    // Serialization also covers asynchronous snapshot compression.
    pending = pending.then(async () => {
      try {
        const request = message.request;
        let result: unknown;
        if (request.type === "initialize" || request.type === "prepare") {
          if (match || setup) throw new Error("Executor already initialized");
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
          if (request.type === "prepare") {
            preparedMap = loaded.map;
            setup = new SpawnSelection(makeMap(loaded.map), options);
            setup.resolve();
            result = { mapHash: await mapIdentity(loaded.map), options };
          } else {
            match = new Skirmish(makeMap(loaded.map), options);
            result = {
              tick: match.tick,
              winner: match.winner,
              packet: await snapshot(),
              rejectedCommands: [],
              seats: seats(),
            } satisfies MatchAdvance;
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
            match = new Skirmish(makeMap(preparedMap), {
              ...setup.options,
              humanSpawns: setup.choices,
            });
            setup = undefined;
            preparedMap = undefined;
            result = {
              tick: match.tick,
              winner: match.winner,
              packet: await snapshot(),
              rejectedCommands: [],
              seats: seats(),
            } satisfies MatchAdvance;
          }
        } else {
          if (!match) throw new Error("Executor not initialized");
          if (request.type === "seat-status") {
            result = { seats: seats() };
          } else if (request.type === "set-controller") {
            match.setAiController(request.playerId, request.ai);
            result = { seats: seats() };
          } else if (request.type === "join-barrier") {
            const player = match.player(request.playerId);
            if (
              !player ||
              player.kind !== "regular" ||
              player.eliminated ||
              match.winner !== null
            )
              throw new Error("This faction is no longer available");
            match.setAiController(player.id, false);
            // Both packets describe exactly S. Advancing the shared cursor here is
            // essential: a tile that changes back after this barrier must be sent.
            const state = match.snapshot();
            const aligned = encoder.encodeJoinBarrier(state);
            const packet = await encodeState(aligned.shared);
            const baseline = await encodeState(aligned.baseline);
            result = {
              tick: match.tick,
              winner: match.winner,
              packet,
              baseline,
              seats: seats(),
            };
          } else if (request.type === "baseline") {
            // A late initial subscriber must not reset everyone else's delta cursor.
            result = await encodeState(
              new SnapshotEncoder(true).encode(match.snapshot()),
            );
          } else if (request.type === "advance") {
            if (
              !Number.isInteger(request.ticks) ||
              request.ticks < 1 ||
              request.ticks > MAX_ADVANCE_TICKS
            )
              throw new Error("Invalid match advance");
            for (const id of request.disconnectedPlayerIds) {
              const player = match.player(id);
              if (player) match.setAiController(id, true);
            }
            const rejectedCommands: MatchAdvance["rejectedCommands"] = [];
            const commands = request.commands.slice(0, 100);
            for (const item of commands) {
              const player = match.player(item.command.playerId);
              const rejection =
                !player || player.ai
                  ? "You are not active in this match"
                  : match.applyCommand(item.command);
              if (rejection)
                rejectedCommands.push({
                  id: item.id,
                  playerId: item.command.playerId,
                  message: rejection,
                });
            }
            for (let i = 0; i < request.ticks; i++) match.step();
            result = {
              tick: match.tick,
              winner: match.winner,
              packet:
                request.publish || match.winner !== null
                  ? await snapshot()
                  : undefined,
              rejectedCommands,
              seats: seats(),
            } satisfies MatchAdvance;
          } else throw new Error("Unknown match operation");
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
