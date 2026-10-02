import { RuntimeDiagnostics, type MatchDiagnostics } from "../../RuntimeDiagnostics";
import { parentPort, threadId } from "node:worker_threads";
import { SpawnSelection } from "../../domain/SpawnSelection";
import { createSkirmishMap } from "../../Elevation";
import { Skirmish } from "../../Simulation";
import type { CommandOutcome } from "../../CommandApplications";
import { SnapshotEncoder } from "../../SnapshotCodec";
import { mapIdentity } from "../application/MapIdentity";
import {
  MAX_ADVANCE_TICKS,
  MAX_COMMAND_BATCH,
  type ExecutorRequest,
  type MatchAdvance,
  type RuntimeMap,
} from "../application/MatchExecutor";
import { encodeState } from "../StateCodec";
import { loadServerMap } from "./ServerMap";

if (!parentPort) throw new Error("The match executor requires a worker thread");
let match: Skirmish | undefined;
const diagnostics = new RuntimeDiagnostics();
let nextDiagnosticTick = 600;
const observeMatch = () => { match!.onPhase = (phase, ms) => diagnostics.record(phase, ms); };
const encoder = new SnapshotEncoder(true);
let setup: SpawnSelection | undefined;
let preparedMap: RuntimeMap | undefined;
let pending = Promise.resolve();
// At most 512 pending receipts plus one 100-command advance can produce
// results between drains. Keep the latest result per input, including control
// transfers performed outside an advance, without retaining state packets.
const commandOutcomes = new Map<string, CommandOutcome>();
const collectOutcome = (outcome: CommandOutcome) => {
  const key = `${outcome.playerId}:${outcome.id}`;
  if (!commandOutcomes.has(key) && commandOutcomes.size >= 2048)
    throw new Error("Command outcome drain budget exceeded");
  commandOutcomes.set(key, outcome);
};
const makeMap = (map: RuntimeMap) =>
  createSkirmishMap(
    map.width,
    map.height,
    map.terrain,
    map.elevation,
    map.forest,
    map.resourceTerrain,
  );
const snapshot = async () => {
  const start = performance.now();
  const packet = encoder.encode(match!.snapshot());
  const captured = performance.now();
  diagnostics.record("snapshot", captured - start);
  const result = await encodeState(packet);
  diagnostics.record("encoding", performance.now() - captured);
  return result;
};
const diagnosticSnapshot = (commands: number, ticksAdvanced: number, payloadBytes: number): MatchDiagnostics => {
  const m = match!, memory = process.memoryUsage(), planning = m.routePlanner.diagnostics;
  return { tick: m.tick, timings: diagnostics.snapshot(), retainedBytes: diagnostics.retainedBytes,
    commands, ticksAdvanced, payloadBytes,
    entities: { squads: m.squads.length, ships: m.ships.length, buildings: m.buildings.length,
      traders: m.expansion?.trade.actors.length ?? 0, projectiles: m.expansion?.battle.projectiles.length ?? 0,
      recruitment: m.recruitment.jobs.length },
    planner: { pending: planning.pending, oldestAge: planning.oldestAge, limited: planning.limited,
      workspaceBytes: planning.workspaceBytes, workspaceUsed: planning.workspaceUsed, receipts: m.commandApplications.diagnostics.pending },
    memory: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external,
      arrayBuffers: memory.arrayBuffers, processRss: memory.rss } };
};
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
    const receivedAt = performance.now();
    // Serialization still covers compression; separate timing makes this debt visible.
    pending = pending.then(async () => {
      diagnostics.record("queue", performance.now() - receivedAt);
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
            match.commandApplications.onOutcome = collectOutcome;
            observeMatch();
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
            match.commandApplications.onOutcome = collectOutcome;
            observeMatch();
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
          } else if (request.type === "client-baseline") {
            const tick=match.tick,winner=match.winner;
            const baseline=await encodeState(new SnapshotEncoder(true).encode(match.snapshot()));
            result={tick,winner,baseline};
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
            if (request.commands.length > MAX_COMMAND_BATCH)
              throw new Error("Match command batch exceeds its budget");
            for (const id of request.disconnectedPlayerIds) {
              const player = match.player(id);
              if (player) match.setAiController(id, true);
            }
            const advanceStarted = performance.now();
            const rejectedCommands: MatchAdvance["rejectedCommands"] = [];
            for (const item of request.commands) {
              const player = match.player(item.command.playerId);
              const outcome: CommandOutcome = !player || player.ai
                ? {id: item.id, playerId: item.command.playerId, tick: match.tick, status: "rejected", reason: "You are not active in this match"}
                : match.commandApplications.apply(item.id, item.command);
              if (!player || player.ai) collectOutcome(outcome);
              const rejection = outcome.status === "rejected" ? outcome.reason : undefined;
              if (rejection)
                rejectedCommands.push({
                  id: item.id,
                  playerId: item.command.playerId,
                  message: rejection,
                });
            }
            diagnostics.record("commands", performance.now() - advanceStarted);
            const previousTick = match.tick;
            for (let i = 0; i < request.ticks; i++) match.step();
            const outcomes = [...commandOutcomes.values()];
            result = {
              tick: match.tick,
              winner: match.winner,
              packet:
                request.publish || match.winner !== null
                  ? await snapshot()
                  : undefined,
              rejectedCommands,
              ...(outcomes.length ? {commandOutcomes: outcomes} : {}),
              seats: seats(),
            } satisfies MatchAdvance;
            diagnostics.record("advance", performance.now() - advanceStarted);
            if (request.publish || match.winner !== null) {
              const advanced = result as MatchAdvance;
              advanced.diagnostics = diagnosticSnapshot(request.commands.length, match.tick - previousTick, advanced.packet?.payload.length ?? 0);
              if (match.tick >= nextDiagnosticTick) {
                nextDiagnosticTick = match.tick + 600;
                console.info(JSON.stringify({ event: "match-runtime-diagnostics", threadId,
                  source: process.env.GIT_COMMIT ?? "unknown", ...advanced.diagnostics }));
              }
            }
            commandOutcomes.clear();
          } else throw new Error("Unknown match operation");
        }
        parentPort!.postMessage({ id: message.id, result });
      } catch (error) {
        // Retain the stack and operation on the server; client transport keeps
        // the safe message and never receives private stack details.
        console.error("Match executor operation failed",message.request.type,error);
        parentPort!.postMessage({
          id: message.id,
          error:
            error instanceof Error ? error.message : "Match executor failed",
        });
      }
    });
  },
);
