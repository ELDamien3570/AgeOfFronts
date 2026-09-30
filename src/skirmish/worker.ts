import { GameMapImpl } from "../core/game/GameMap";
import type { WorkerRequest, WorkerResponse } from "./Protocol";
import { TICKS_PER_SECOND } from "./Protocol";
import { Skirmish } from "./Simulation";
import { SnapshotEncoder, snapshotTransfers } from "./SnapshotCodec";

let match: Skirmish | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let paused = false;
let speed: 1 | 2 | 4 = 1;
let encoder = new SnapshotEncoder();

function send(message: WorkerResponse): void {
  self.postMessage(message);
}
function publish(): void {
  if (!match) return;
  const packet = encoder.encode({
    tick: match.tick,
    width: match.map.width(),
    height: match.map.height(),
    owners: match.owners,
    claims: match.claims,
    progress: match.progress,
    players: match.players,
    buildings: match.buildings,
    ships: match.ships,
    squads: match.squads,
    volleys: match.volleys,
    winner: match.winner,
    combatTicks: match.combatTicks,
  });
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
      const map = new GameMapImpl(
        message.width,
        message.height,
        message.terrain,
        0,
      );
      match = new Skirmish(map, message.options);
      encoder = new SnapshotEncoder();
      publish();
      timer = setInterval(() => {
        try {
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
    } else if (message.type === "command") {
      const rejection = match?.applyCommand(message.command);
      if (rejection) send({ type: "rejected", message: rejection });
      publish();
    } else if (message.type === "pause") {
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
