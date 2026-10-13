import { createSkirmishMap } from "./Elevation";
import type { WorkerRequest, WorkerResponse } from "./Protocol";
import { MAX_ORDER_SQUADS } from "./FactionRules";
import { TICKS_PER_SECOND } from "./Protocol";
import { Skirmish } from "./Simulation";
import { SnapshotEncoder, snapshotTransfers } from "./SnapshotCodec";
import { SPAWN_SECONDS, SpawnSelection } from "./domain/SpawnSelection";
import { RuntimeDiagnostics, RuntimeProgress } from "./RuntimeDiagnostics";
import { LocalTickSchedule } from "./LocalTickSchedule";
import { LocalTickWakeup } from "./LocalTickWakeup";

let match: Skirmish | undefined;
const wakeup = new LocalTickWakeup(advance);
const tickMs = 1000 / TICKS_PER_SECOND;
const clock = new LocalTickSchedule(tickMs);
let paused = false;
let speed: 1 | 2 | 4 = 1;
let encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true });
let setup: SpawnSelection | undefined;
let spawnDeadline = 0;
let spawnPublishedAt = 0;
let lastPublishedAt = 0;
let diagnostics: RuntimeDiagnostics | undefined;
let progress = new RuntimeProgress(1000 / TICKS_PER_SECOND);
let nextDiagnosticsAt = 0;

function observeMatch(): void {
  if (!match || !diagnostics) return;
  match.onPhase = (phase, ms) => diagnostics?.record(phase, ms);
  progress.reset(match.tick, performance.now());
}

function send(message: WorkerResponse): void {
  self.postMessage(message);
}
function reportFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Local game worker failed at tick ${match?.tick ?? 0}`, error);
  send({ type: "error", message: match ? `The match stopped at tick ${match.tick}: ${detail}` : detail });
}
function publish(): void {
  if (!match) return;
  lastPublishedAt = performance.now();
  const started = diagnostics ? performance.now() : 0;
  const packet = encoder.encode(match.replicationSource(true), match.tileChanges, match.replicationFacts());
  diagnostics?.record("encoding", performance.now() - started);
  self.postMessage(
    { type: "state", packet, paused, speed } satisfies WorkerResponse,
    { transfer: snapshotTransfers(packet) },
  );
  if (diagnostics) {
    const now = performance.now();
    if (paused) progress.reset(match.tick, now); else progress.record(match.tick, now);
    if (now >= nextDiagnosticsAt) {
      nextDiagnosticsAt = now + 5000;
      send({ type: "diagnostics", tick: match.tick, pace: progress.snapshot(), timings: diagnostics.snapshot(), squads: match.squads.length, ships: match.ships.length,
        planner: match.routePlanner.diagnosticCohorts(match.tick) });
    }
  }
}

function schedule(): void {
  const delay = setup || paused || !match || match.winner !== null ? tickMs : clock.delay(performance.now());
  wakeup.schedule(delay);
}
function advance(): void {
  try {
    if (setup) {
      const now = performance.now();
      if (now >= spawnDeadline) {
        match = new Skirmish(setup.map, { ...setup.options, humanSpawns: setup.choices });
        setup = undefined;
        observeMatch();
        clock.reset(performance.now(), speed);
        publish();
      } else if (now - spawnPublishedAt >= 250) {
        spawnPublishedAt = now;
        send({ type: "spawn", state: setup.state(spawnDeadline - now) });
      }
    } else if (match && !paused && match.winner === null) {
      const started = performance.now();
      match.step();
      if (speed === 1 || match.winner !== null || performance.now() - lastPublishedAt >= tickMs) publish();
      diagnostics?.record("advance", performance.now() - started);
      clock.advanced(performance.now());
    }
    schedule();
  } catch (error) {
    wakeup.cancel();
    reportFailure(error);
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "start") {
      wakeup.cancel();
      paused = false;
      match = undefined;
      setup = undefined;
      diagnostics = message.diagnostics ? new RuntimeDiagnostics(512) : undefined;
      progress = new RuntimeProgress(1000 / TICKS_PER_SECOND);
      nextDiagnosticsAt = 0;
      const map = createSkirmishMap(
        message.width,
        message.height,
        message.terrain,
        message.elevation,
        message.forest,
        message.resourceTerrain,
      );
      if (message.checkpoint) {
        match = new Skirmish(map, message.options);
        match.restore(message.checkpoint);
        observeMatch();
      } else {
        setup = new SpawnSelection(map, message.options);
        setup.resolve();
        spawnDeadline = performance.now() + SPAWN_SECONDS * 1000;
        spawnPublishedAt = performance.now();
        send({ type: "spawn", state: setup.state(SPAWN_SECONDS * 1000) });
      }
      encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true });
      clock.reset(performance.now(), speed);
      if (match) publish();
      schedule();
    } else if (message.type === "select-spawn") {
      const rejection =
        !setup || performance.now() >= spawnDeadline
          ? "Spawn selection has closed"
          : setup.select(1, message.tile);
      if (rejection) send({ type: "rejected", message: rejection });
      if (setup)
        send({
          type: "spawn",
          state: setup.state(spawnDeadline - performance.now()),
        });
    } else if (message.type === "command") {
      if (setup) {
        send({
          type: "rejected",
          message: "Choose your spawn before issuing orders",
        });
        if (diagnostics && message.diagnosticId !== undefined)
          send({ type: "command-admitted", diagnosticId: message.diagnosticId, tick: 0, rejected: true });
        return;
      }
      const command=message.command;
      const oversized=["order","charge","attack-structure"].includes(command.type) &&
        "squadIds" in command && command.squadIds.length>MAX_ORDER_SQUADS;
      const rejection = oversized ? `Select at most ${MAX_ORDER_SQUADS} squads` : match?.applyCommand(command);
      if (diagnostics && message.diagnosticId !== undefined)
        send({ type: "command-admitted", diagnosticId: message.diagnosticId, tick: match?.tick ?? 0, rejected: !!rejection || !match });
      if (rejection) send({ type: "rejected", message: rejection });
      if (paused || performance.now() - lastPublishedAt >= 30) publish();
    } else if (message.type === "resync") {
      // Reset every replication cursor together without restarting the match.
      encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true });
      publish();
    } else if (message.type === "pause") {
      if (setup) return;
      paused = message.paused;
      if (match) progress.reset(match.tick, performance.now());
      clock.reset(performance.now(), speed);
      schedule();
      publish();
    } else if (message.type === "speed" && [1, 2, 4].includes(message.speed)) {
      speed = message.speed;
      clock.reset(performance.now(), speed);
      schedule();
      publish();
    }
  } catch (error) {
    wakeup.cancel();
    reportFailure(error);
  }
};
