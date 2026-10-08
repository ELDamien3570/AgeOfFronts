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
import { PublicationQueue } from "../application/PublicationQueue";
import { RecoveryBaselineCache } from "../application/RecoveryBaselineCache";
import { SnapshotEncodingWorker } from "./SnapshotEncodingWorker";
import type { SnapshotPacket } from "../../Protocol";
import { loadServerMap } from "./ServerMap";
import { observeGarbageCollection } from "./WorkerRuntimeDiagnostics";

if (!parentPort) throw new Error("The match executor requires a worker thread");
let match: Skirmish | undefined;
let streamPublications = false;
const encoding = new SnapshotEncodingWorker();
const baselines = new RecoveryBaselineCache();
let canonicalVersion = 0;
const invalidateBaselines = () => { canonicalVersion++; baselines.invalidate(); };
parentPort.on("close", () => baselines.close());
parentPort.on("close", () => { void encoding.close(); });
const diagnostics = new RuntimeDiagnostics();
const stopObserving = observeGarbageCollection(diagnostics);
parentPort.on("close", stopObserving);
let diagnosticContext = { matchId: "unassigned", runtimeId: "unknown" };
let captureSequence = 0, capturedTick = 0;
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
// A deferred command whose first cohort committed is visible movement too.
let commandProgress = false;
const collectProgress = () => { commandProgress = true; };
const makeMap = (map: RuntimeMap) =>
  createSkirmishMap(
    map.width,
    map.height,
    map.terrain,
    map.elevation,
    map.forest,
    map.resourceTerrain,
  );
const capture = () => {
  const state = diagnostics.measure("extraction", () => match!.replicationSource());
  const packet = diagnostics.measure("snapshot", () => encoder.encode(state, match!.tileChanges, match!.replicationFacts()));
  capturedTick = packet.tick;
  captureSequence++;
  return packet;
};
const encodePacket = (packet: SnapshotPacket) => diagnostics.measureAsync("encoding", () => encoding.encode(packet));
const snapshot = () => encodePacket(capture());
const recoveryBaseline = () => baselines.get(canonicalVersion, () => {
  const state = diagnostics.measure("extraction", () => match!.replicationSource());
  const packet = diagnostics.measure("snapshot", () => new SnapshotEncoder(true).encode(state, match!.tileChanges, match!.replicationFacts()));
  capturedTick = state.tick; captureSequence++;
  return encodePacket(packet);
});
const publications = new PublicationQueue(encodePacket,
  (tick, packet) => diagnostics.measure("transfer", () => parentPort!.postMessage({ publication: { tick, packet } })),
  error => parentPort!.postMessage({ fatal: `Snapshot publication failed: ${error.message}` }));
const diagnosticSnapshot = (commands: number, ticksAdvanced: number, payloadBytes: number): MatchDiagnostics => {
  const m = match!, memory = process.memoryUsage(), planning = m.routePlanner.diagnostics;
  return { tick: m.tick, timings: diagnostics.snapshot(), lifetimeTimings: diagnostics.lifetimeSnapshot(), retainedBytes: diagnostics.retainedBytes,
    correlation: { ...diagnosticContext, source: process.env.GIT_COMMIT ?? "unknown", runtime: process.version,
      threadId, tick: capturedTick, captureSequence },
    commands, ticksAdvanced, payloadBytes,
    replication: { pending: publications.pending, skipped: publications.skipped, encoderMemory: encoding.memory,
      encoderTimings: { ...encoding.timings, ...encoding.diagnostics.snapshot() },
      encoderRetainedBytes: encoding.retainedBytes + encoding.diagnostics.retainedBytes, encoderFailureCause: encoding.failureCause,
      baselineCache: {...baselines.diagnostics, retainedBytes: baselines.retainedBytes},
      extraction: {...encoder.diagnostics} },
    paths: { land: m.paths.residency, water: m.waterPaths.residency },
    domainWork: { spatial: m.spatialDiagnostics && { ...m.spatialDiagnostics },
      trade: m.expansion && { ...m.expansion.trade.diagnostics } },
    entities: { squads: m.squads.length, ships: m.ships.length, buildings: m.buildings.length,
      traders: m.expansion?.trade.actors.length ?? 0, projectiles: m.expansion?.battle.projectiles.length ?? 0,
      recruitment: m.recruitment.jobs.length },
    planner: { pending: planning.pending, oldestAge: planning.oldestAge, limited: planning.limited,
      preparation: { pending: m.movementAdmission.preparationCount, ...m.movementAdmission.preparationDiagnostics },
      workspaceBytes: planning.workspaceBytes, workspaceUsed: planning.workspaceUsed, receipts: m.commandApplications.diagnostics.pending,
      work: planning.work, completed: planning.completed, superseded: planning.superseded, admissionDeferred: planning.admissionDeferred,
      cohorts: m.routePlanner.diagnosticCohorts(m.tick) },
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
          streamPublications = request.streamPublications === true;
          diagnosticContext = request.diagnosticContext ?? diagnosticContext;
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
            match.commandApplications.onProgress = collectProgress;
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
            match.commandApplications.onProgress = collectProgress;
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
          if (["baseline", "client-baseline", "join-barrier"].includes(request.type)) await publications.flush();
          if (request.type === "seat-status") {
            result = { seats: seats() };
          } else if (request.type === "set-controller") {
            invalidateBaselines();
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
            invalidateBaselines();
            match.setAiController(player.id, false);
            // Both packets describe exactly S. Advancing the shared cursor here is
            // essential: a tile that changes back after this barrier must be sent.
            const state = diagnostics.measure("extraction", () => match!.replicationSource());
            const aligned = diagnostics.measure("snapshot", () => encoder.encodeJoinBarrier(state, match!.tileChanges, match!.replicationFacts()));
            capturedTick = state.tick; captureSequence++;
            const packet = await encodePacket(aligned.shared);
            const baseline = await encodePacket(aligned.baseline);
            baselines.remember(canonicalVersion, baseline);
            result = {
              tick: match.tick,
              winner: match.winner,
              packet,
              baseline,
              seats: seats(),
            };
          } else if (request.type === "client-baseline") {
            const tick=match.tick,winner=match.winner;
            const baseline = await recoveryBaseline();
            result={tick,winner,baseline};
          } else if (request.type === "baseline") {
            // A late initial subscriber must not reset everyone else's delta cursor.
            result = await recoveryBaseline();
          } else if (request.type === "advance") {
            invalidateBaselines();
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
              packet: undefined,
              rejectedCommands,
              ...(outcomes.length ? {commandOutcomes: outcomes} : {}),
              seats: seats(),
            } satisfies MatchAdvance;
            // A committed player command should be visible in its authoritative
            // result tick, rather than waiting for the 5 Hz background cadence.
            // Deferred/rejected commands do not expose uncommitted intentions;
            // a committed lead cohort of a deferred selection is published.
            // Offer once per advance through the same bounded, ordered queue.
            const publish = request.publish || commandProgress || outcomes.some(outcome => outcome.status === "executed");
            commandProgress = false;
            if (publish || match.winner !== null) {
              if (streamPublications && match.winner === null) publications.offer(match.tick, capture);
              else {
                await publications.flush();
                (result as MatchAdvance).packet = await snapshot();
              }
            }
            diagnostics.record("advance", performance.now() - advanceStarted);
            if (publish || match.winner !== null) {
              const advanced = result as MatchAdvance;
              advanced.diagnostics = diagnosticSnapshot(request.commands.length, match.tick - previousTick, advanced.packet?.binary?.byteLength ?? advanced.packet?.payload.length ?? 0);
              if (match.tick >= nextDiagnosticTick) {
                nextDiagnosticTick = match.tick + 600;
                console.info(JSON.stringify({ event: "match-runtime-diagnostics", threadId,
                  source: process.env.GIT_COMMIT ?? "unknown", ...advanced.diagnostics }));
              }
            }
            commandOutcomes.clear();
          } else throw new Error("Unknown match operation");
        }
        diagnostics.measure("transfer", () => parentPort!.postMessage({ id: message.id, result }));
      } catch (error) {
        // Retain the stack and operation on the server; client transport keeps
        // the safe message and never receives private stack details.
        console.error("Match executor operation failed",message.request.type,error);
        if (match?.failureReason) parentPort!.postMessage({ fatal: `Simulation recovery failed: ${match.failureReason}`, failureCause: "recovery" });
        parentPort!.postMessage({
          id: message.id,
          error:
            error instanceof Error ? error.message : "Match executor failed",
        });
      }
    });
  },
);
