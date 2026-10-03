import { createSkirmishMap } from "./Elevation";
import type { WorkerRequest, WorkerResponse } from "./Protocol";
import { TICKS_PER_SECOND } from "./Protocol";
import { Skirmish } from "./Simulation";
import { SnapshotEncoder, snapshotTransfers } from "./SnapshotCodec";
import { SPAWN_SECONDS, SpawnSelection } from "./domain/SpawnSelection";

let match: Skirmish | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = false;
let speed: 1 | 2 | 4 = 1;
let encoder = new SnapshotEncoder();
let setup: SpawnSelection | undefined;
let spawnDeadline = 0;
let spawnPublishedAt = 0;
let lastPublishedAt = 0;

function send(message: WorkerResponse): void {
  self.postMessage(message);
}
function publish(): void {
  if (!match) return;
  lastPublishedAt = performance.now();
  const packet = encoder.encode(match.replicationSource(), match.tileChanges, match.replicationFacts());
  self.postMessage(
    { type: "state", packet, paused, speed } satisfies WorkerResponse,
    { transfer: snapshotTransfers(packet) },
  );
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const message = event.data;
    if (message.type === "start") {
      clearInterval(timer);
      paused = false;
      match = undefined;
      const map = createSkirmishMap(
        message.width,
        message.height,
        message.terrain,
        message.elevation,
        message.forest,
        message.resourceTerrain,
      );
      setup = new SpawnSelection(map, message.options);
      setup.resolve();
      spawnDeadline = performance.now() + SPAWN_SECONDS * 1000;
      spawnPublishedAt = performance.now();
      encoder = new SnapshotEncoder();
      send({ type: "spawn", state: setup.state(SPAWN_SECONDS * 1000) });
      timer = setInterval(() => {
        try {
          if (setup) {
            const now = performance.now();
            if (now >= spawnDeadline) {
              match = new Skirmish(setup.map, {
                ...setup.options,
                humanSpawns: setup.choices,
              });
              setup = undefined;
              publish();
            } else if (now - spawnPublishedAt >= 250) {
              spawnPublishedAt = now;
              send({ type: "spawn", state: setup.state(spawnDeadline - now) });
            }
            return;
          }
          if (match && !paused && match.winner === null) {
            for (let i = 0; i < speed; i++) match.step();
            publish();
          }
        } catch (error) {
          clearInterval(timer);
          send({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "The match stopped unexpectedly",
          });
        }
      }, 1000 / TICKS_PER_SECOND);
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
        return;
      }
      const rejection = match?.applyCommand(message.command);
      if (rejection) send({ type: "rejected", message: rejection });
      if (paused || performance.now() - lastPublishedAt >= 30) publish();
    } else if (message.type === "pause") {
      if (setup) return;
      paused = message.paused;
      publish();
    } else if (message.type === "speed" && [1, 2, 4].includes(message.speed)) {
      speed = message.speed;
      publish();
    }
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error ? error.message : "Unable to start this match",
    });
  }
};
