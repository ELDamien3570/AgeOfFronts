import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import type {
  MatchManifest,
  ServerMessage,
} from "../../src/skirmish/multiplayer/Protocol";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

it("runs two thin clients from one server simulation, enforces ownership and continues after one leaves", async () => {
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
  const tokens: string[] = [];
  const clients: WebSocket[] = [],
    all: ServerMessage[][] = [[], []];
  const errors: Error[] = [];
  let sequence = 0,
    manifest: MatchManifest | undefined;
  const send = (client: WebSocket, message: object) => {
    const requestId = `req-${++sequence}`;
    client.send(JSON.stringify({ requestId, ...message }));
    return requestId;
  };
  const until = async (predicate: () => boolean) => {
    const deadline = performance.now() + 15_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (performance.now() > deadline)
        throw new Error("Timed out waiting for server-only match");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const last = <T>(items: T[]): T => items[items.length - 1];
  const states = (index: number) =>
    all[index].filter(
      (message): message is Extract<ServerMessage, { type: "match-state" }> =>
        message.type === "match-state",
    );
  try {
    for (let index = 0; index < 2; index++) {
      const guest = store.createGuest();
      tokens.push(guest.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, { origin });
      clients.push(socket);
      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as ServerMessage;
          all[index].push(message);
          if (message.type === "match") {
            manifest = message.manifest;
            // A thin client loads its map then reports version readiness. No host is created.
            send(socket, {
              type: "match-ready",
              matchId: message.manifest.id,
              runtimeId: message.manifest.runtimeId,
            });
          }
        } catch (error) {
          errors.push(error as Error);
        }
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
      title: "Server test",
      settings: {
        ...defaultLobbySettings("heightmap-test1", 250),
        countdownSeconds: 15,
        aiCount: 0,
        tribeCount: 0,
      },
      willingToWait: false,
    });
    await until(() =>
      all[0].some((message) => message.type === "ack" && !!message.roomId),
    );
    const roomId = (
      all[0].find(
        (message) => message.type === "ack" && !!message.roomId,
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
        messages.some((message) => message.type === "match-spawn"),
      ),
    );
    expect(states(0)).toHaveLength(0);
    now += 10_000;
    await until(
      () =>
        states(0).some((message) => message.tick === 0) &&
        states(1).some((message) => message.tick === 0),
    );
    const initial = await decodeState<SnapshotPacket>(states(0)[0].packet);
    expect(initial.reset).toBe(true);
    expect(initial.tick).toBe(0);
    expect(states(0)[0].packet.hash).toBe(states(1)[0].packet.hash);
    now += 200;
    await until(
      () =>
        states(0).some((message) => message.tick === 4) &&
        states(1).some((message) => message.tick === 4),
    );
    expect(last(states(0)).packet.hash).toBe(last(states(1)).packet.hash);
    expect(
      (await decodeState<SnapshotPacket>(last(states(0)).packet)).reset,
    ).toBe(false);
    expect(all.flat().some((message) => message.type.startsWith("host-"))).toBe(
      false,
    );
    expect(
      states(0).every(
        (message) => message.executor === "server" && !message.paused,
      ),
    ).toBe(true);
    // Authenticated socket identity overrides a forged command player ID.
    const commandId = send(clients[1], {
      type: "match-command",
      matchId: manifest!.id,
      command: {
        type: "research",
        playerId: 1,
        technologyId: "rus-stoneage-port-sea-trade",
      },
    });
    await until(() =>
      all[1].some(
        (message) => message.type === "ack" && message.requestId === commandId,
      ),
    );
    now += 200;
    await until(() => states(1).some((message) => message.tick >= 8));
    const paidState = await decodeState<SnapshotPacket>(last(states(1)).packet);
    expect(
      Object.values(paidState.expansion!.progression![2].research).some(
        (job) => job?.technologyId === "rus-stoneage-port-sea-trade",
      ),
    ).toBe(true);
    expect(
      Object.values(paidState.expansion!.progression![1].research).some(
        (job) => job?.technologyId === "rus-stoneage-port-sea-trade",
      ),
    ).toBe(false);
    // A duplicate tab must not take over an already-loaded seat or forfeit the existing player.
    const duplicate = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
      origin,
    });
    clients.push(duplicate);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      duplicate.on("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      ),
    );
    await new Promise<void>((resolve) => duplicate.on("open", resolve));
    duplicate.send(JSON.stringify({ type: "authenticate", token: tokens[0] }));
    expect(await closed).toEqual({ code: 4001, reason: "Match already open" });
    expect(clients[0].readyState).toBe(WebSocket.OPEN);
    expect(
      coordinator.rooms.snapshot().reservations[0].members[0].connected,
    ).toBe(true);
    now += 200;
    await until(() => states(0).some((message) => message.tick >= 12));
    expect(states(0)[states(0).length - 1].disconnectedPlayerIds).toEqual([]);
    clients[0].close();
    await until(
      () =>
        coordinator.rooms.snapshot().reservations[0]?.members[0].connected ===
        false,
    );
    const before = last(states(1)).tick;
    now += 200;
    await until(() => states(1).some((message) => message.tick > before));
    const remaining = last(states(1));
    expect(remaining.executor).toBe("server");
    expect(remaining.disconnectedPlayerIds).toEqual([1]);
    expect(
      (await decodeState<SnapshotPacket>(remaining.packet)).players[0].ai,
    ).toBe(true);
    clients[1].close();
    await until(() => coordinator.rooms.snapshot().reservations[0].members.every(member => !member.connected));
    expect(coordinator.rooms.snapshot().reservations).toHaveLength(1);
    now += 120_001;
    await until(() => coordinator.rooms.snapshot().reservations.length === 0);
    expect(errors).toEqual([]);
  } finally {
    for (const client of clients) client.terminate();
    await coordinator.close();
    store.close();
  }
}, 30_000);
