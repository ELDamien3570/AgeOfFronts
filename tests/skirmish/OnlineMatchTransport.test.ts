import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { HostedRuntime } from "../../src/skirmish/multiplayer/application/HostedRuntime";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import type {
  MatchManifest,
  ServerMessage,
} from "../../src/skirmish/multiplayer/Protocol";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import type { Skirmish } from "../../src/skirmish/Simulation";

it("connects two authenticated players through lobby start, shared updates and host loss", async () => {
  const origin = "http://localhost:9010";
  const store = new CoordinatorStore(":memory:");
  let now = 0;
  const coordinator = createCoordinatorServer({
    store,
    origins: [origin],
    matchCapacity: 1,
    now: () => now,
  });
  await new Promise<void>((resolve) =>
    coordinator.http.listen(0, "127.0.0.1", resolve),
  );
  const port = (coordinator.http.address() as { port: number }).port;
  const clients: WebSocket[] = [];
  const all: ServerMessage[][] = [[], []];
  const errors: Error[] = [];
  let sequence = 0,
    host: HostedRuntime | undefined,
    manifest: MatchManifest | undefined;
  const send = (client: WebSocket, message: object) =>
    client.send(JSON.stringify({ requestId: `req-${++sequence}`, ...message }));
  const until = async (predicate: () => boolean) => {
    const timeout = performance.now() + 15_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (performance.now() > timeout) throw new Error("Timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    for (let index = 0; index < 2; index++) {
      const guest = store.createGuest();
      const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, { origin });
      clients.push(socket);
      let queue = Promise.resolve();
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        all[index].push(message);
        queue = queue
          .then(async () => {
            if (message.type === "match") {
              manifest = message.manifest;
              if (index === 0) {
                const loaded = await loadServerMap(message.manifest.settings);
                host = new HostedRuntime(loaded.map, message.manifest.options);
              }
              send(socket, {
                type: "match-ready",
                matchId: message.manifest.id,
                runtimeId: message.manifest.runtimeId,
                tickP95Ms: index === 0 ? 1 : 50,
              });
            } else if (message.type === "host-restore" && index === 0) {
              host!.restore(
                await decodeState<ReturnType<Skirmish["checkpoint"]>>(
                  message.checkpoint,
                ),
                message.stateId,
              );
              send(socket, {
                type: "host-ready",
                matchId: message.matchId,
                epoch: message.epoch,
                tick: host!.match.tick,
                hash: message.stateId,
              });
            } else if (message.type === "host-batch" && index === 0) {
              send(socket, {
                type: "host-commit",
                matchId: message.matchId,
                epoch: message.epoch,
                proposal: await host!.run(message.batch),
              });
            }
          })
          .catch((error) => {
            errors.push(error);
          });
      });
      await new Promise<void>((resolve) => socket.on("open", resolve));
      socket.send(JSON.stringify({ type: "authenticate", token: guest.token }));
    }
    await until(() =>
      all.every((messages) =>
        messages.some((message) => message.type === "directory"),
      ),
    );
    send(clients[0], {
      type: "create",
      title: "Friends",
      settings: {
        ...defaultLobbySettings("heightmap-test1"),
        worldSize: 250,
        countdownSeconds: 15,
      },
      willingToWait: false,
    });
    await until(() =>
      all[0].some((message) => message.type === "ack" && message.roomId),
    );
    const roomId = (
      all[0].find(
        (message) => message.type === "ack" && message.roomId,
      ) as Extract<ServerMessage, { type: "ack" }>
    ).roomId;
    send(clients[1], { type: "join", roomId });
    await until(() =>
      coordinator.rooms
        .snapshot()
        .rooms.some((room) => room.id === roomId && room.members.length === 2),
    );
    now = 15_000;
    await until(() =>
      all.every((messages) =>
        messages.some(
          (message) =>
            message.type === "match-state" &&
            !message.paused &&
            message.tick > 0,
        ),
      ),
    );
    const states = all.map((messages) =>
      messages.filter(
        (message): message is Extract<ServerMessage, { type: "match-state" }> =>
          message.type === "match-state" && !message.paused && message.tick > 0,
      ),
    );
    await until(() =>
      all[1].some(
        (message) =>
          message.type === "match-state" &&
          message.packet.hash === states[0][0].packet.hash,
      ),
    );
    expect((await decodeState<SnapshotPacket>(states[0][0].packet)).tick).toBe(
      4,
    );
    // A claimed player ID is replaced with this socket's authenticated faction.
    send(clients[1], {
      type: "match-command",
      matchId: manifest!.id,
      command: {
        type: "research",
        playerId: 1,
        technologyId: "stoneage-shorecraft",
      },
    });
    now += 200;
    await until(
      () =>
        all[1].filter(
          (message) =>
            message.type === "match-state" &&
            !message.paused &&
            message.tick > 0,
        ).length >= 2,
    );
    const paid = all[1]
      .filter(
        (message): message is Extract<ServerMessage, { type: "match-state" }> =>
          message.type === "match-state" && !message.paused && message.tick > 4,
      )
      .pop()!;
    const paidState = await decodeState<SnapshotPacket>(paid.packet);
    expect(
      Object.values(paidState.expansion!.progression[2].research).some(
        (job) => job?.technologyId === "stoneage-shorecraft",
      ),
    ).toBe(true);
    expect(
      Object.values(paidState.expansion!.progression[1].research).some(
        (job) => job?.technologyId === "stoneage-shorecraft",
      ),
    ).toBe(false);
    clients[0].close();
    await until(
      () =>
        coordinator.rooms.snapshot().reservations[0]?.members[0].connected ===
        false,
    );
    now += 200;
    await until(() =>
      all[1].some(
        (message) =>
          message.type === "match-state" &&
          !message.paused &&
          message.tick > 0 &&
          message.executor === "server",
      ),
    );
    const fallback = all[1].find(
      (message) =>
        message.type === "match-state" &&
        !message.paused &&
        message.tick > 0 &&
        message.executor === "server",
    ) as Extract<ServerMessage, { type: "match-state" }>;
    expect(fallback.disconnectedPlayerIds).toEqual([1]);
    expect(
      (await decodeState<SnapshotPacket>(fallback.packet)).tick,
    ).toBeGreaterThan(4);
    clients[1].close();
    await until(() => coordinator.rooms.snapshot().reservations.length === 0);
    expect(errors).toEqual([]);
  } finally {
    for (const client of clients) client.terminate();
    await coordinator.close();
    store.close();
  }
}, 30_000);
