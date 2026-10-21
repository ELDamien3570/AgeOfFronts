import { RuntimeDiagnostics, ThreadCpuWindow, type CpuClock, type MatchDiagnostics, type RuntimePhase, type TimingSummary } from "../../RuntimeDiagnostics";
import { SpawnSelection } from "../../domain/SpawnSelection";
import { createSkirmishMap } from "../../Elevation";
import { Skirmish } from "../../Simulation";
import type { CommandOutcome } from "../../CommandApplications";
import { SnapshotEncoder } from "../../SnapshotCodec";
import type { LobbySettings } from "../../lobby/LobbyDirectory";
import { mapIdentity } from "./MapIdentity";
import {
  MAX_ADVANCE_TICKS,
  MAX_COMMAND_BATCH,
  MATCH_FAULT_CODE,
  type ExecutorRequest,
  type MatchAdvance,
  type RuntimeMap,
} from "./MatchExecutor";
import { PublicationQueue } from "./PublicationQueue";
import { preparePlan } from "./PreparePlan";
import { MatchAdvanceRunner, MatchFaultError } from "./MatchAdvanceRunner";
import { RecoveryBaselineCache } from "./RecoveryBaselineCache";
import {
  publicExecutorError,
  SIMULATION_RECOVERY_FAILED_MESSAGE,
  SNAPSHOT_PUBLICATION_FAILED_MESSAGE,
} from "./TerminalMessages";
import { secondsToTicks, TICKS_PER_SECOND } from "../../Protocol";
import type { SnapshotPacket } from "../../Protocol";
import type { EncodedState } from "../StateCodec";

/** Encodes immutable snapshot packets. The server runs one on its own thread;
 * a hosting browser encodes inline (encodeState reads the packet synchronously
 * before its first await, so the world may advance while it compresses). */
export interface RuntimeEncoder {
  encode(packet: SnapshotPacket): Promise<EncodedState>;
  /** With direct publications the encoder posts the publication itself. */
  encode(packet: SnapshotPacket, publication: { tick: number; sequence: number }): Promise<undefined>;
  readonly memory?: { heapUsed: number; external: number; arrayBuffers: number };
  readonly timings?: Partial<Record<RuntimePhase, TimingSummary>>;
  readonly diagnostics: RuntimeDiagnostics;
  readonly retainedBytes: number;
  readonly failureCause?: string;
  close(): Promise<void>;
}

/** Everything the match runtime needs from the thread that hosts it. */
export interface MatchRuntimeHost {
  /** Results ({id,result|error,publicationsIssued}), relayed publications and fatal notices. */
  post(message: unknown): void;
  encoder: RuntimeEncoder;
  /** The encoder delivers streamed publications itself (server N6b port). */
  directPublications: boolean;
  loadMap(settings: LobbySettings, seed: number): Promise<{ map: RuntimeMap; territoryIncomeScale: number }>;
  memory(): { heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; rss: number };
  cpuClock?: CpuClock;
  /** Live heap after a full collection, sampled at the 30 s diagnostic cadence. */
  liveHeap?: () => number | undefined;
  observeGarbageCollection?: (diagnostics: RuntimeDiagnostics) => () => void;
  source: string;
  runtime: string;
  threadId: number;
  rollback: boolean;
  testFaultTick?: number;
  testPrepareFailures?: number;
  /** Diagnostic logging (the browser host sends no per-advance diagnostics). */
  diagnostics?: boolean;
}

export interface MatchRuntime {
  handle(message: { id: number; request: ExecutorRequest }): void;
  close(): void;
}

/** The authoritative simulation behind a MatchExecutor, independent of the
 * thread and transport it runs on (server worker thread or a hosting browser). */
export function createMatchRuntime(host: MatchRuntimeHost): MatchRuntime {
  let match: Skirmish | undefined;
  let streamPublications = false;
  const encoding = host.encoder;
  let publicationsIssued = 0;
  const baselines = new RecoveryBaselineCache();
  let canonicalVersion = 0;
  const invalidateBaselines = () => { canonicalVersion++; baselines.invalidate(); };
  const reportDiagnostics = host.diagnostics !== false;
  const diagnostics = new RuntimeDiagnostics(256, true, host.cpuClock);
  // Thread CPU of runner.step per 400 simulated ticks; wall/CPU > 1.5 flags a
  // contended host (I-0). liveHeap is sampled only at the 30 s log cadence.
  const stepCpu = new ThreadCpuWindow();
  let liveHeap: { bytes: number; tick: number } | undefined;
  const stopObserving = host.observeGarbageCollection?.(diagnostics) ?? (() => {});
  let diagnosticContext = { matchId: "unassigned", runtimeId: "unknown" };
  let captureSequence = 0, capturedTick = 0;
  let nextDiagnosticTick = 600;
  let runner: MatchAdvanceRunner | undefined;
  // The exact map and options the match was built from: a rollback rebuilds a
  // fresh simulation from them and restores the last checkpoint into it.
  let runtime: { map: RuntimeMap; options: ConstructorParameters<typeof Skirmish>[1] } | undefined;
  // Tests only (ReservedMatchWorker testFaultTick): one injected throw when the
  // simulation steps from this tick, so the real rollback path can be exercised.
  const testFaultTick = host.testFaultTick;
  // Tests only (ReservedMatchWorker testPrepareFailures): the first N map
  // generations throw, to exercise the real prepare retry (R2-L7).
  let testPrepareFailures = host.testPrepareFailures ?? 0;
  let testFaultInjected = false;
  // Rollback containment only when the operator opted in (SKIRMISH_ROLLBACK=1):
  // without it the runner holds no checkpoint and a fault ends the match.
  const rollback = host.rollback;
  const attach = (target: Skirmish) => {
    if (testFaultTick !== undefined) {
      const step = target.step.bind(target);
      target.step = () => {
        if (!testFaultInjected && target.tick === testFaultTick) { testFaultInjected = true; throw new Error("Injected test fault"); }
        step();
      };
    }
    target.commandApplications.onOutcome = collectOutcome;
    target.commandApplications.onProgress = collectProgress;
    target.onPhase = (phase, ms) => diagnostics.record(phase, ms);
  };
  const startMatch = (map: RuntimeMap, options: ConstructorParameters<typeof Skirmish>[1]) => {
    runtime = { map, options };
    match = new Skirmish(makeMap(map), options);
    attach(match);
    runner = new MatchAdvanceRunner(match, () => ({ ...diagnosticContext, source: host.source }), undefined, !rollback ? undefined : {
      create: () => new Skirmish(makeMap(runtime!.map), runtime!.options),
      attach,
      installed: (recovered) => {
        // Queued captures already hold packets; the old encoder's delta cursor
        // describes the abandoned world, so the next publication is a baseline.
        match = recovered;
        encoder = new SnapshotEncoder(true, networkEncoding);
        invalidateBaselines();
      },
    });
    runner.clock = { wall: () => performance.now(), cpu: () => diagnostics.cpuNow() };
  };
  const networkEncoding = { compactFormationSlots: true, compactTraders: true };
  let encoder = new SnapshotEncoder(true, networkEncoding);
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
  // Borrowed traders: the encoder skips unchanged rows by detail revision and
  // copies the rest synchronously, so live actors never outlive this call. The
  // packets are byte-identical to the projected path (scripts/fixtureParityPair.ts
  // --candidate-borrowed).
  const replicationSource = () => match!.replicationSource(true);
  const capture = () => {
    const state = diagnostics.measure("extraction", replicationSource);
    const packet = diagnostics.measure("snapshot", () => encoder.encode(state, match!.tileChanges, match!.replicationFacts()));
    capturedTick = packet.tick;
    captureSequence++;
    return packet;
  };
  const encodePacket = (packet: SnapshotPacket) => diagnostics.measureAsync("encoding", () => encoding.encode(packet));
  const snapshot = () => encodePacket(capture());
  const recoveryBaseline = () => baselines.get(canonicalVersion, () => {
    const state = diagnostics.measure("extraction", replicationSource);
    const packet = diagnostics.measure("snapshot", () => encoder.encodeBaseline(state, match!.tileChanges, match!.replicationFacts()));
    capturedTick = state.tick; captureSequence++;
    return encodePacket(packet);
  });
  type StreamedCapture = { packet: SnapshotPacket; tick: number; sequence: number };
  const publications = new PublicationQueue<StreamedCapture, { sequence: number; packet?: EncodedState }>(
    value => diagnostics.measureAsync("encoding", async () => host.directPublications
      ? (await encoding.encode(value.packet, { tick: value.tick, sequence: value.sequence }), { sequence: value.sequence })
      : { sequence: value.sequence, packet: await encoding.encode(value.packet) }),
    (tick, { sequence, packet }) => {
      // Without direct publications (browser hosts), publications hop through this thread.
      if (packet) diagnostics.measure("transfer", () => host.post({ publication: { tick, packet, sequence } }));
    },
    error => {
      console.error("Snapshot publication failed", error);
      host.post({ fatal: SNAPSHOT_PUBLICATION_FAILED_MESSAGE });
    });
  // Path residency walks every cached search tree; refresh it at most once per
  // simulated second instead of on every publication. Diagnostics only.
  let pathResidency: { tick: number; value: MatchDiagnostics["paths"] } | undefined;
  const pathResidencyFor = (m: Skirmish): MatchDiagnostics["paths"] => {
    if (!pathResidency || m.tick < pathResidency.tick || m.tick - pathResidency.tick >= TICKS_PER_SECOND)
      pathResidency = { tick: m.tick, value: { land: m.paths.residency, water: m.waterPaths.residency,
        ...(m.amphibiousPaths ? { amphibious: m.amphibiousPaths.residency } : {}) } };
    return pathResidency.value;
  };
  const diagnosticSnapshot = (commands: number, ticksAdvanced: number, payloadBytes: number): MatchDiagnostics => {
    const m = match!, memory = host.memory(), planning = m.routePlanner.diagnostics;
    return { tick: m.tick, timings: diagnostics.snapshot(), lifetimeTimings: diagnostics.lifetimeSnapshot(), retainedBytes: diagnostics.retainedBytes,
      correlation: { ...diagnosticContext, source: host.source, runtime: host.runtime,
        threadId: host.threadId, tick: capturedTick, captureSequence },
      commands, ticksAdvanced, payloadBytes,
      replication: { pending: publications.pending, skipped: publications.skipped, encoderMemory: encoding.memory,
        encoderTimings: { ...encoding.timings, ...encoding.diagnostics.snapshot() },
        encoderRetainedBytes: encoding.retainedBytes + encoding.diagnostics.retainedBytes, encoderFailureCause: encoding.failureCause,
        baselineCache: {...baselines.diagnostics, retainedBytes: baselines.retainedBytes},
        extraction: {...encoder.diagnostics} },
      paths: pathResidencyFor(m),
      domainWork: { spatial: m.spatialDiagnostics && { ...m.spatialDiagnostics },
        trade: m.expansion && { ...m.expansion.trade.diagnostics,
          ...(m.expansion.trade.seaTrade ? { sea: {
            ...m.expansion.trade.seaTrade.routes.usage,
            accepted: m.expansion.trade.seaTrade.routes.diagnostics.accepted,
            refused: m.expansion.trade.seaTrade.routes.diagnostics.refused,
            completed: m.expansion.trade.seaTrade.routes.diagnostics.completed,
            readyHits: m.expansion.trade.seaTrade.routes.diagnostics.readyHits,
            reversedHits: m.expansion.trade.seaTrade.routes.diagnostics.reversedHits,
            departures: m.expansion.trade.seaTrade.diagnostics.departures,
            arrivals: m.expansion.trade.seaTrade.diagnostics.arrivals,
            cycles: m.expansion.trade.seaTrade.diagnostics.cycles,
            directReturns: m.expansion.trade.seaTrade.diagnostics.directReturns,
            retracedReturns: m.expansion.trade.seaTrade.diagnostics.retracedReturns,
          } } : {}) } },
      entities: { squads: m.squads.length, ships: m.ships.length, buildings: m.buildings.length,
        traders: m.expansion?.trade.actors.length ?? 0, projectiles: m.expansion?.battle.projectiles.length ?? 0,
        recruitment: m.recruitment.jobs.length },
      planner: { pending: planning.pending, oldestAge: planning.oldestAge, limited: planning.limited,
        preparation: { pending: m.movementAdmission.preparationCount, ...m.movementAdmission.preparationDiagnostics },
        workspaceBytes: planning.workspaceBytes, workspaceUsed: planning.workspaceUsed, receipts: m.commandApplications.diagnostics.pending,
        work: planning.work, completed: planning.completed, superseded: planning.superseded, admissionDeferred: planning.admissionDeferred,
        cohorts: m.routePlanner.diagnosticCohorts(m.tick) },
      memory: { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external,
        arrayBuffers: memory.arrayBuffers, processRss: memory.rss,
        ...(liveHeap ? { liveHeapBytes: liveHeap.bytes, liveHeapTick: liveHeap.tick } : {}) },
      ...(stepCpu.snapshot() ? { cpu: stepCpu.snapshot() } : {}) };
  };
  const seats = () =>
    match!.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ai: p.ai,
      kind: p.kind,
      eliminated: p.eliminated,
    }));

  const handle = (message: { id: number; request: ExecutorRequest }) => {
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
          if (request.type === "prepare") {
            // A generator invariant failure retries with a derived seed; the
            // seed that worked is in plan.prepared.options (R2-L7).
            const plan = await preparePlan(request, {
              load: (settings, seed) => {
                if (testPrepareFailures > 0) { testPrepareFailures--; throw new Error("Injected generator failure"); }
                return host.loadMap(settings, seed);
              },
              identity: mapIdentity,
              makeMap,
              now: () => performance.now(),
              log: (level, event) => console[level === "warn" ? "warn" : "info"](JSON.stringify(event)),
            });
            preparedMap = plan.map;
            setup = plan.setup;
            result = plan.prepared;
          } else {
            const loaded = request.map
              ? {
                  map: request.map,
                  territoryIncomeScale: request.options.territoryIncomeScale,
                }
              : await host.loadMap(request.settings, request.options.seed);
            const options = {
              ...request.options,
              territoryIncomeScale: loaded.territoryIncomeScale,
            };
            startMatch(loaded.map, options);
            match = match!;
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
            startMatch(preparedMap, {
              ...setup.options,
              humanSpawns: setup.choices,
            });
            match = match!;
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
          // A faulted world is never advanced, published or handed to joiners.
          if (request.type !== "seat-status") runner!.assertHealthy();
          if (["baseline", "client-baseline", "join-barrier"].includes(request.type)) await publications.flush();
          if (request.type === "seat-status") {
            result = { seats: seats() };
          } else if (request.type === "set-controller") {
            invalidateBaselines();
            runner!.setController(request.playerId, request.ai);
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
            runner!.setController(player.id, false);
            // Both packets describe exactly S. Advancing the shared cursor here is
            // essential: a tile that changes back after this barrier must be sent.
            const state = diagnostics.measure("extraction", replicationSource);
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
            const advanceStarted = performance.now(), previousTick = match.tick, stepCpuStarted = diagnostics.cpuNow();
            // Disconnected seats, commands and ticks run as one journaled advance;
            // a fault rolls back to the last checkpoint when it can (MatchJournal).
            const { rejectedCommands, rolledBack } = runner!.advance({
              commands: request.commands, ticks: request.ticks, disconnectedPlayerIds: request.disconnectedPlayerIds,
            }, collectOutcome);
            match = runner!.match;
            // The journaled advance applies commands and steps ticks in one call
            // (rollback needs both). The runner times its stages apart, so
            // "commands" is command application only, "checkpoint" the rollback
            // checkpoint, and "simulate" (with its paired thread CPU, I-0) the
            // tick steps only: a checkpoint hitch never reads as contention.
            const stages = runner!.lastTimings;
            if (stages) {
              diagnostics.record("commands", stages.commands.wall, stages.commands.cpu);
              if (stages.checkpoint) diagnostics.record("checkpoint", stages.checkpoint.wall, stages.checkpoint.cpu);
              diagnostics.record("simulate", stages.ticks.wall, stages.ticks.cpu);
              stepCpu.add(match.tick - previousTick, stages.ticks.wall, stages.ticks.cpu);
            } else {
              const stepWall = performance.now() - advanceStarted, stepCpuEnded = diagnostics.cpuNow();
              const stepCpuMs = stepCpuStarted === undefined || stepCpuEnded === undefined ? undefined : stepCpuEnded - stepCpuStarted;
              diagnostics.record("simulate", stepWall, stepCpuMs);
              stepCpu.add(match.tick - previousTick, stepWall, stepCpuMs);
            }
            const outcomes = [...commandOutcomes.values()];
            result = {
              tick: match.tick,
              winner: match.winner,
              packet: undefined,
              rejectedCommands,
              ...(outcomes.length ? {commandOutcomes: outcomes} : {}),
              ...(rolledBack ? {rolledBack: true} : {}),
              seats: seats(),
            } satisfies MatchAdvance;
            // The coordinator's 5 Hz gate decides background publications. A
            // committed command (or the committed lead cohort of a deferred
            // selection) is published on the advance that made it visible, so a
            // player's order reaches clients without waiting for the gate; at
            // most one publication per tick.
            const commandVisible = commandProgress || outcomes.some(outcome => outcome.status === "executed");
            commandProgress = false;
            if (commandVisible) (result as MatchAdvance).commandVisible = true;
            // A command that became visible publishes on this advance instead
            // of waiting for the coordinator's background gate.
            const publish = rolledBack || request.publish || commandVisible;
            if (publish) (result as MatchAdvance).published = true;
            if (publish || match.winner !== null) {
              // After a rollback the reply carries the new encoder's first,
              // complete packet; the host sends it to every seat as a rebase.
              if (streamPublications && match.winner === null && !rolledBack)
                publications.offer(match.tick, () => ({ packet: capture(), tick: match!.tick, sequence: ++publicationsIssued }));
              else {
                await publications.flush();
                (result as MatchAdvance).packet = await snapshot();
              }
            }
            diagnostics.record("advance", performance.now() - advanceStarted);
            if (reportDiagnostics && (publish || match.winner !== null)) {
              const advanced = result as MatchAdvance;
              advanced.diagnostics = diagnosticSnapshot(request.commands.length, match.tick - previousTick, advanced.packet?.binary?.byteLength ?? advanced.packet?.payload.length ?? 0);
              if (match.tick >= nextDiagnosticTick) {
                nextDiagnosticTick = match.tick + secondsToTicks(30);
                const live = host.liveHeap?.();
                if (live !== undefined) {
                  liveHeap = { bytes: live, tick: match.tick };
                  advanced.diagnostics.memory = { ...advanced.diagnostics.memory, liveHeapBytes: live, liveHeapTick: match.tick };
                }
                console.info(JSON.stringify({ event: "match-runtime-diagnostics", threadId: host.threadId,
                  source: host.source, ...advanced.diagnostics }));
              }
            }
            commandOutcomes.clear();
          } else throw new Error("Unknown match operation");
        }
        // Only results that carry packets continue the delta chain and must
        // follow earlier publications; an advance result is never held back
        // behind its own still-encoding publication.
        const ordered = ["baseline", "client-baseline", "join-barrier"].includes(message.request.type) ||
          (message.request.type === "advance" && (result as MatchAdvance).packet !== undefined);
        diagnostics.measure("transfer", () => host.post({ id: message.id, result, publicationsIssued: ordered ? publicationsIssued : 0 }));
      } catch (error) {
        // Retain the stack, operation and raw text on the server. Clients
        // receive only deliberate messages or one fixed string (L11).
        if (error instanceof MatchFaultError) {
          // The structured fault report was already logged once by the runner.
          commandOutcomes.clear();
          host.post({ id: message.id, error: MATCH_FAULT_CODE });
          return;
        }
        console.error("Match executor operation failed",message.request.type,error);
        if (match?.failureReason) {
          console.error("Simulation recovery failed", match.failureReason);
          host.post({ fatal: SIMULATION_RECOVERY_FAILED_MESSAGE, failureCause: "recovery" });
        }
        host.post({
          id: message.id,
          error: publicExecutorError(error),
        });
      }
    });
  };
  return {
    handle,
    close: () => {
      baselines.close();
      void encoding.close();
      stopObserving();
    },
  };
}
