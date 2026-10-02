import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import type {
  MatchManifest,
  ServerMessage,
} from "../../src/skirmish/multiplayer/Protocol";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

it("joins and reclaims through real WebSockets with one atomic authoritative snapshot and bounded grace", async () => {
  const store = new CoordinatorStore(":memory:");
  let now = 0,
    sequence = 0;
  const coordinator = createCoordinatorServer({
    store,
    origins: [],
    matchCapacity: 1,
    now: () => now,
    liveMatch: { cooldownMs: 0 },
    createExecutor: () => {
      const worker = new ReservedMatchWorker();
      return {
        close: () => worker.close(),
        request: (request) =>
          worker.request(
            request.type === "prepare"
              ? {
                  ...request,
                  map: {
                    width: 240,
                    height: 160,
                    terrain: new Uint8Array(38400).fill(133),
                  },
                }
              : request,
          ),
      };
    },
  });
  await new Promise<void>((resolve) =>
    coordinator.http.listen(0, "127.0.0.1", resolve),
  );
  const port = (coordinator.http.address() as { port: number }).port;
  type Client = { socket: WebSocket; token: string; messages: ServerMessage[] };
  const clients: Client[] = [];
  const until = async (predicate: () => boolean) => {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > deadline)
        throw new Error(
          "Timed out: " +
            JSON.stringify(clients.map((c) => c.messages.slice(-3))),
        );
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const send = (c: Client, message: object) => {
    const requestId = `join-${++sequence}`;
    c.socket.send(JSON.stringify({ ...message, requestId }));
    return requestId;
  };
  const response = async (c: Client, requestId: string) => {
    await until(() =>
      c.messages.some(
        (m) =>
          (m.type === "ack" || m.type === "error") && m.requestId === requestId,
      ),
    );
    return c.messages.find(
      (m) =>
        (m.type === "ack" || m.type === "error") && m.requestId === requestId,
    )!;
  };
  const open = async (token = store.createGuest().token) => {
    const c: Client = {
      socket: new WebSocket(`ws://127.0.0.1:${port}/socket`),
      token,
      messages: [],
    };
    clients.push(c);
    c.socket.on("message", (raw) =>
      c.messages.push(JSON.parse(raw.toString())),
    );
    await new Promise<void>((resolve) => c.socket.on("open", resolve));
    c.socket.send(JSON.stringify({ type: "authenticate", token }));
    await until(() => c.messages.some((m) => m.type === "directory"));
    return c;
  };
  const states = (c: Client) =>
    c.messages.filter(
      (m): m is Extract<ServerMessage, { type: "match-state" }> =>
        m.type === "match-state",
    );
  const lastState = (c: Client) => states(c).slice(-1)[0]!;
  const close = async (c: Client) => {
    c.socket.close();
    await new Promise<void>((resolve) => c.socket.on("close", () => resolve()));
  };
  let manifest: MatchManifest;
  const watch = async (c: Client, playerId?: number) => {
    const r = await response(
      c,
      send(c, { type: "watch-match", matchId: manifest.id, playerId }),
    );
    expect(r.type).toBe("ack");
    return c.messages
      .filter(
        (m): m is Extract<ServerMessage, { type: "match" }> =>
          m.type === "match",
      )
      .slice(-1)[0]!.manifest;
  };
  const ready = async (c: Client) =>
    response(
      c,
      send(c, {
        type: "match-ready",
        matchId: manifest.id,
        runtimeId: manifest.runtimeId,
      }),
    );
  const ack = async (c: Client) => {
    const state = lastState(c);
    expect(state.syncId).toBeTruthy();
    const decoded = await decodeState<SnapshotPacket>(state.packet);
    expect(decoded.reset).toBe(true);
    expect(decoded.tick).toBe(state.tick);
    return response(
      c,
      send(c, {
        type: "match-sync-applied",
        matchId: manifest.id,
        syncId: state.syncId,
        publicationSequence: state.publicationSequence,
      }),
    );
  };
  try {
    const a = await open(),
      b = await open();
    await response(
      a,
      send(a, {
        type: "profile",
        profile: { name: "Remember me", flagCode: null },
      }),
    );
    const created = await response(
      a,
      send(a, {
        type: "create",
        title: "Persistent empires",
        settings: {
          ...defaultLobbySettings("africa", 250),
          slots: 3,
          minimumHumans: 2,
          countdownSeconds: 15,
          aiCount: 2,
          tribeCount: 1,
          publicAiTakeover: true,
        },
        willingToWait: false,
      }),
    );
    expect(created.type).toBe("ack");
    const roomId = (created as Extract<ServerMessage, { type: "ack" }>).roomId;
    await response(b, send(b, { type: "join", roomId }));
    now = 15000;
    await until(() =>
      [a, b].every((c) => c.messages.some((m) => m.type === "match")),
    );
    manifest = (
      a.messages.find((m) => m.type === "match") as Extract<
        ServerMessage,
        { type: "match" }
      >
    ).manifest;
    await ready(a);
    await ready(b);
    await until(() => a.messages.some((m) => m.type === "match-spawn"));
    now += 10000;
    await until(() => states(a).length > 0 && states(b).length > 0);
    // Real domain data must survive takeover, including an active research job.
    await response(
      a,
      send(a, {
        type: "match-command",
        matchId: manifest.id,
        command: { type: "research", technologyId: "stoneage-cargo-canoes" },
      }),
    );
    now += 200;
    await until(() => lastState(a).tick >= 4);
    await close(a);
    await until(
      () =>
        coordinator.rooms.snapshot().reservations[0].members[0].connected ===
        false,
    );
    now += 200;
    await until(() => lastState(b).tick >= 8);
    const away = await decodeState<SnapshotPacket>(lastState(b).packet);
    expect(away.players[0].ai).toBe(true);
    const impersonator = await open();
    await response(
      impersonator,
      send(impersonator, {
        type: "profile",
        profile: { name: "Remember me", flagCode: null },
      }),
    );
    expect(
      await response(
        impersonator,
        send(impersonator, {
          type: "watch-match",
          matchId: manifest.id,
          playerId: 1,
        }),
      ),
    ).toMatchObject({
      type: "error",
      message: expect.stringMatching(/reserved/),
    });
    const returning = await open(a.token);
    expect((await watch(returning)).playerId).toBe(1);
    const beforeLoad = lastState(b).tick;
    now += 200;
    await until(() => lastState(b).tick > beforeLoad); // no pause during asset loading
    expect(await ready(returning)).toMatchObject({ type: "ack" });
    await until(() => !!lastState(returning)?.syncId);
    const baseline = await decodeState<SnapshotPacket>(
      lastState(returning).packet,
    );
    expect(baseline.players[0].ai).toBe(false);
    expect(
      Object.values(baseline.expansion!.progression[1].research).some(
        (job) => job?.technologyId === "stoneage-cargo-canoes",
      ),
    ).toBe(true);
    expect(lastState(b).tick).toBe(lastState(returning).tick);
    expect(lastState(b).publicationSequence).toBe(
      lastState(returning).publicationSequence,
    );
    expect(
      await response(
        returning,
        send(returning, {
          type: "match-command",
          matchId: manifest.id,
          command: { type: "advance-age" },
        }),
      ),
    ).toMatchObject({ type: "error" });
    const paused = lastState(b).tick;
    now += 200;
    await new Promise((r) => setTimeout(r, 80));
    expect(lastState(b).tick).toBe(paused);
    expect(await ack(returning)).toMatchObject({ type: "ack" });
    expect(
      await response(
        returning,
        send(returning, {
          type: "watch-match",
          matchId: manifest.id,
          playerId: 3,
        }),
      ),
    ).toMatchObject({
      type: "error",
      message: expect.stringMatching(/already own/),
    });
    now += 200;
    await until(() => lastState(b).tick > paused);
    // Two browsers load the same AI, but only one can reserve the frozen barrier.
    const rival = await open();
    await watch(impersonator, 3);
    await watch(rival, 3);
    const [r1, r2] = await Promise.all([ready(impersonator), ready(rival)]);
    expect([r1.type, r2.type].sort()).toEqual(["ack", "error"]);
    const winner = r1.type === "ack" ? impersonator : rival,
      loser = winner === impersonator ? rival : impersonator;
    expect(await ack(winner)).toMatchObject({ type: "ack" });
    expect(
      await response(
        loser,
        send(loser, { type: "watch-match", matchId: manifest.id, playerId: 4 }),
      ),
    ).toMatchObject({
      type: "error",
      message: expect.stringMatching(/human seats/),
    });
    expect(coordinator.rooms.snapshot().reservations[0].members).toHaveLength(
      3,
    );
    // A loaded controller is protected; an old socket close cannot disconnect it.
    const duplicate = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    const duplicateClosed = new Promise<number>((resolve) =>
      duplicate.on("close", (code) => resolve(code)),
    );
    await new Promise<void>((resolve) => duplicate.on("open", resolve));
    duplicate.send(
      JSON.stringify({ type: "authenticate", token: returning.token }),
    );
    expect(await duplicateClosed).toBe(4001);
    expect(returning.socket.readyState).toBe(WebSocket.OPEN);
    await close(returning);
    await close(b);
    await close(winner);
    await until(() =>
      coordinator.rooms
        .snapshot()
        .reservations[0].members.every((m) => !m.connected),
    );
    expect(coordinator.rooms.snapshot().reservations).toHaveLength(1);
    const resume = await open(a.token);
    await watch(resume);
    now += 60000;
    expect(await ready(resume)).toMatchObject({
      type: "error",
      message: expect.stringMatching(/Loading timed out/),
    });
    // Failed joins did not refresh the original all-left deadline.
    now += 60001;
    await until(() => coordinator.rooms.snapshot().reservations.length === 0);
  } finally {
    for (const c of clients) c.socket.terminate();
    await coordinator.close();
    store.close();
  }
}, 30000);

it("drops stale persisted match reservations on server restart without advertising a recovered world", async () => {
  const store = new CoordinatorStore(":memory:");
  store.write({
    version: 1,
    nextSequence: 4,
    rooms: [],
    reservations: [
      {
        id: "match-3",
        roomId: "room-2",
        title: "Old world",
        createdAt: 0,
        settings: defaultLobbySettings("africa"),
        members: [
          {
            guestId: "guest",
            profile: { name: "Owner", flagCode: null },
            connected: true,
            joinedAt: 0,
          },
        ],
      },
    ],
  });
  const coordinator = createCoordinatorServer({
    store,
    origins: [],
    matchCapacity: 1,
  });
  try {
    expect(coordinator.rooms.snapshot().reservations).toEqual([]);
    expect(store.read()?.reservations).toEqual([]);
    expect(coordinator.rooms.snapshot().nextSequence).toBe(4);
  } finally {
    await coordinator.close();
    store.close();
  }
});
