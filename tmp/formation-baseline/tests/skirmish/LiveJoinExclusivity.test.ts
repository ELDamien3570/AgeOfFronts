import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
  RuntimeSeat,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import type {
  MatchManifest,
  ServerMessage,
} from "../../src/skirmish/multiplayer/Protocol";

/** Tiny deterministic world; this regression exercises real socket admission fencing. */
function executor(): MatchExecutor {
  let tick = 0;
  const seats: RuntimeSeat[] = [1, 2, 3].map((playerId) => ({
    playerId,
    name: `Faction ${playerId}`,
    ai: playerId > 1,
    kind: "regular",
    eliminated: false,
  }));
  const packet = { hash: "a".repeat(64), payload: "test" };
  return {
    close: async () => {},
    request: async <T extends ExecutorResult>(request: ExecutorRequest) => {
      let result: unknown;
      switch (request.type) {
        case "prepare":
          result = { mapHash: "test", options: request.options };
          break;
        case "spawn-state":
          result = { remainingMs: request.remainingMs };
          break;
        case "start":
          result = { tick, winner: null, packet, seats, rejectedCommands: [] };
          break;
        case "advance":
          tick += request.ticks;
          result = {
            tick,
            winner: null,
            packet: request.publish ? packet : undefined,
            seats,
            rejectedCommands: [],
          };
          break;
        case "join-barrier":
          seats.find((seat) => seat.playerId === request.playerId)!.ai = false;
          result = { tick, winner: null, packet, baseline: packet, seats };
          break;
        case "set-controller":
          seats.find((seat) => seat.playerId === request.playerId)!.ai =
            request.ai;
          result = { seats };
          break;
        default:
          throw new Error(`Unexpected executor request ${request.type}`);
      }
      return result as T;
    },
  };
}

it("fences one socket to one pending or claimed match and releases admission on leave", async () => {
  let now = 0,
    sequence = 0;
  const store = new CoordinatorStore(":memory:");
  const server = createCoordinatorServer({
    store,
    origins: [],
    now: () => now,
    matchCapacity: 2,
    createExecutor: executor,
    liveMatch: { cooldownMs: 0 },
  });
  const clients: {
    socket: WebSocket;
    messages: ServerMessage[];
    guestId: string;
  }[] = [];
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  const port = (server.http.address() as { port: number }).port;
  const until = async (predicate: () => boolean) => {
    const deadline = performance.now() + 5_000;
    while (!predicate()) {
      if (performance.now() > deadline)
        throw new Error(
          `Timed out: ${JSON.stringify(clients.map((client) => client.messages.slice(-3)))}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const open = async () => {
    const guest = store.createGuest();
    const client = {
      socket: new WebSocket(`ws://127.0.0.1:${port}/socket`),
      messages: [] as ServerMessage[],
      guestId: guest.guestId,
    };
    clients.push(client);
    client.socket.on("message", (raw) =>
      client.messages.push(JSON.parse(raw.toString())),
    );
    await new Promise<void>((resolve, reject) => {
      client.socket.once("open", resolve);
      client.socket.once("error", reject);
    });
    client.socket.send(
      JSON.stringify({ type: "authenticate", token: guest.token }),
    );
    await until(() =>
      client.messages.some((message) => message.type === "directory"),
    );
    return client;
  };
  const request = async (client: (typeof clients)[number], message: object) => {
    const requestId = `exclusive-${++sequence}`;
    client.socket.send(JSON.stringify({ ...message, requestId }));
    await until(() =>
      client.messages.some(
        (reply) =>
          (reply.type === "ack" || reply.type === "error") &&
          reply.requestId === requestId,
      ),
    );
    return client.messages.find(
      (reply) =>
        (reply.type === "ack" || reply.type === "error") &&
        reply.requestId === requestId,
    )!;
  };
  const manifest = (client: (typeof clients)[number]): MatchManifest =>
    (
      client.messages.find((message) => message.type === "match") as Extract<
        ServerMessage,
        { type: "match" }
      >
    ).manifest;
  try {
    const a = await open(),
      b = await open(),
      newcomer = await open();
    for (const [host, title] of [
      [a, "First match"],
      [b, "Second match"],
    ] as const) {
      expect(
        await request(host, {
          type: "create",
          title,
          settings: {
            ...defaultLobbySettings("africa", 250),
            slots: 2,
            minimumHumans: 1,
            countdownSeconds: 15,
            aiCount: 2,
            tribeCount: 0,
            publicAiTakeover: true,
          },
          willingToWait: false,
        }),
      ).toMatchObject({ type: "ack" });
    }
    now = 15_000;
    await until(() =>
      [a, b].every((client) =>
        client.messages.some((message) => message.type === "match"),
      ),
    );
    const first = manifest(a),
      second = manifest(b);
    expect(first.id).not.toBe(second.id);
    for (const [host, match] of [
      [a, first],
      [b, second],
    ] as const)
      expect(
        await request(host, {
          type: "match-ready",
          matchId: match.id,
          runtimeId: match.runtimeId,
        }),
      ).toMatchObject({ type: "ack" });
    await until(() =>
      [a, b].every((client) =>
        client.messages.some((message) => message.type === "match-spawn"),
      ),
    );
    now = 25_000;
    await until(() =>
      [a, b].every((client) =>
        client.messages.some((message) => message.type === "match-state"),
      ),
    );
    expect(
      await request(newcomer, {
        type: "watch-match",
        matchId: first.id,
        playerId: 2,
      }),
    ).toMatchObject({ type: "ack" });
    for (const message of [
      { type: "watch-match", matchId: second.id, playerId: 2 },
      { type: "match-ready", matchId: second.id, runtimeId: second.runtimeId },
      {
        type: "match-sync-applied",
        matchId: second.id,
        syncId: "forged-sync",
        publicationSequence: 1,
      },
    ])
      expect(await request(newcomer, message)).toMatchObject({
        type: "error",
        message: expect.stringMatching(/other match/),
      });
    expect(
      server.rooms
        .snapshot()
        .reservations.every((match) => match.members.length === 1),
    ).toBe(true);
    expect(await request(newcomer, { type: "leave" })).toMatchObject({
      type: "ack",
    });
    expect(
      await request(newcomer, {
        type: "watch-match",
        matchId: second.id,
        playerId: 2,
      }),
    ).toMatchObject({ type: "ack" });
    expect(
      await request(newcomer, {
        type: "match-ready",
        matchId: second.id,
        runtimeId: second.runtimeId,
      }),
    ).toMatchObject({ type: "ack" });
    const baseline = newcomer.messages.find(
      (message): message is Extract<ServerMessage, { type: "match-state" }> =>
        message.type === "match-state" &&
        message.matchId === second.id &&
        !!message.syncId,
    )!;
    expect(baseline).toBeDefined();
    expect(
      await request(newcomer, {
        type: "match-sync-applied",
        matchId: second.id,
        syncId: baseline.syncId,
        publicationSequence: baseline.publicationSequence,
      }),
    ).toMatchObject({ type: "ack" });
    expect(
      server.rooms
        .snapshot()
        .reservations.find((match) => match.id === first.id)!.members,
    ).toHaveLength(1);
    expect(
      server.rooms
        .snapshot()
        .reservations.find((match) => match.id === second.id)!
        .members.find((member) => member.guestId === newcomer.guestId)
        ?.connected,
    ).toBe(true);
    expect(
      await request(newcomer, {
        type: "watch-match",
        matchId: first.id,
        playerId: 2,
      }),
    ).toMatchObject({
      type: "error",
      message: expect.stringMatching(/other match/),
    });
  } finally {
    for (const client of clients) client.socket.terminate();
    await server.close();
    store.close();
  }
}, 20_000);
