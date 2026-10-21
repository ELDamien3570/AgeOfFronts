import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createMatchRuntime } from "../../src/skirmish/multiplayer/application/MatchRuntime";
import { InlineSnapshotEncoder } from "../../src/skirmish/multiplayer/application/InlineSnapshotEncoder";
import { HOST_LEFT_MESSAGE } from "../../src/skirmish/multiplayer/application/TerminalMessages";
import { decodeHostFrame, encodeHostFrame } from "../../src/skirmish/multiplayer/HostWire";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import { computeRuntimeBuild } from "../../src/skirmish/multiplayer/infrastructure/RuntimeBuild";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import type { ExecutorRequest } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { MatchManifest, ServerMessage } from "../../src/skirmish/multiplayer/Protocol";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";

/** The custom room owner's "browser": the shared match runtime behind a /host socket. */
function hostBrowser(port: number, origin: string, token: string, matchId: string, seaTradeRouting?: "lanes-v1") {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/host`, { origin });
  const runtime = createMatchRuntime({
    post: (message) => { if (socket.readyState === WebSocket.OPEN) socket.send(encodeHostFrame(message)); },
    encoder: new InlineSnapshotEncoder(),
    directPublications: false,
    loadMap: (settings, seed) => loadServerMap(settings, undefined, seed),
    memory: () => process.memoryUsage(),
    source: "test-host",
    runtime: "test",
    threadId: 0,
    rollback: false,
    diagnostics: false,
  });
  const frames = { received: 0 };
  socket.on("open", () =>
    socket.send(JSON.stringify({ type: "host-authenticate", token, matchId, runtimeId: computeRuntimeBuild() })));
  socket.on("message", (data) => {
    frames.received++;
    const frame = decodeHostFrame(data as Buffer) as { id: number; request: ExecutorRequest };
    if (seaTradeRouting && (frame.request.type === "prepare" || frame.request.type === "initialize"))
      frame.request = { ...frame.request, options: { ...frame.request.options, seaTradeRouting } };
    runtime.handle(frame);
  });
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => { runtime.close(); resolve(code); }));
  return { socket, frames, closed };
}

it.each([undefined, "lanes-v1"] as const)("runs a custom match in its owner's browser: states reach every player, the server simulates nothing, and the match ends with the host (%s)", async (seaTradeRouting) => {
  const origin = "http://localhost:9010";
  const store = new CoordinatorStore(":memory:");
  let now = 0;
  // No server capacity at all: a hosted match must not need any.
  const coordinator = createCoordinatorServer({ store, origins: [origin], matchCapacity: 0, now: () => now });
  await new Promise<void>((resolve) => coordinator.http.listen(0, "127.0.0.1", resolve));
  const port = (coordinator.http.address() as { port: number }).port;
  const tokens: string[] = [];
  const clients: WebSocket[] = [];
  const all: ServerMessage[][] = [[], [], []];
  const errors: Error[] = [];
  let sequence = 0, manifest: MatchManifest | undefined, host: ReturnType<typeof hostBrowser> | undefined;
  const send = (client: WebSocket, message: object) => {
    const requestId = `req-${++sequence}`;
    client.send(JSON.stringify({ requestId, ...message }));
    return requestId;
  };
  const until = async (predicate: () => boolean, label = "hosted match") => {
    const deadline = performance.now() + 20_000;
    while (!predicate()) {
      if (errors.length) throw errors[0];
      if (performance.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const last = <T>(items: T[]): T => items[items.length - 1];
  const states = (index: number) =>
    all[index].filter((message): message is Extract<ServerMessage, { type: "match-state" }> => message.type === "match-state");
  const latestDirectory = (index: number) =>
    last(all[index].filter((message): message is Extract<ServerMessage, { type: "directory" }> => message.type === "directory"));
  try {
    for (let index = 0; index < 3; index++) {
      const guest = store.createGuest();
      tokens.push(guest.token);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, { origin });
      clients.push(socket);
      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as ServerMessage;
          all[index].push(message);
          if (message.type === "host-match") host = hostBrowser(port, origin, tokens[index], message.matchId, seaTradeRouting);
          if (message.type === "match") {
            manifest = message.manifest;
            send(socket, { type: "match-ready", matchId: message.manifest.id, runtimeId: message.manifest.runtimeId });
          }
        } catch (error) {
          errors.push(error as Error);
        }
      });
      await new Promise<void>((resolve) => socket.on("open", resolve));
      socket.send(JSON.stringify({ type: "authenticate", token: guest.token }));
    }
    await until(() => all.every((messages) => messages.some((message) => message.type === "directory")));
    send(clients[0], {
      type: "create",
      title: "Hosted test",
      settings: { ...defaultLobbySettings("heightmap-test1", 250), countdownSeconds: 15, aiCount: 0, tribeCount: 0 },
    });
    await until(() => all[0].some((message) => message.type === "ack" && !!message.roomId));
    const roomId = (all[0].find((message) => message.type === "ack" && !!message.roomId) as Extract<ServerMessage, { type: "ack" }>).roomId;
    send(clients[1], { type: "join", roomId });
    await until(() => coordinator.rooms.snapshot().rooms.some((room) => room.id === roomId && room.members.length === 2));
    now = 15_000;
    await until(() => host !== undefined, "the host request");
    // Only the owner is asked to host.
    expect(all[1].some((message) => message.type === "host-match")).toBe(false);
    await until(() => all[0].concat(all[1]).filter((message) => message.type === "match-spawn").length >= 2, "spawn selection");
    expect(manifest?.hostedBy).toBeTypeOf("string");
    expect(coordinator.rooms.snapshot().reservations[0].hostId).toBeDefined();
    now += 10_000;
    await until(() => states(0).some((message) => message.tick === 0) && states(1).some((message) => message.tick === 0), "the first state");
    const initial = await decodeState<SnapshotPacket>(states(0)[0].packet);
    expect(initial.reset).toBe(true);
    expect(states(0)[0].packet.hash).toBe(states(1)[0].packet.hash);
    now += 250;
    await until(() => states(0).some((message) => message.tick >= 1) && states(1).some((message) => message.tick >= 1), "a delta");
    expect(last(states(0)).packet.hash).toBe(last(states(1)).packet.hash);
    // The server proxied the host's simulation: no worker ran it here.
    expect(coordinator.runtimeDiagnostics().matches[0].worker).toBeUndefined();
    // A player's order travels to the host's simulation and back.
    const commandId = send(clients[1], {
      type: "match-command",
      matchId: manifest!.id,
      command: { type: "research", playerId: 1, technologyId: "rus-stoneage-port-sea-trade" },
    });
    await until(() => all[1].some((message) => message.type === "ack" && message.requestId === commandId), "the command ack");
    const researched = () => {
      const decoder = new SnapshotDecoder();
      let state!: ReturnType<SnapshotDecoder["decode"]>;
      return (async () => {
        for (const message of states(1)) state = decoder.decode(await decodeState<SnapshotPacket>(message.packet));
        return Object.values(state.expansion!.progression![2].research).some((job) => job?.technologyId === "rus-stoneage-port-sea-trade");
      })();
    };
    let done = false;
    await until(() => {
      void researched().then((value) => { done = value; });
      if (!done) now += 125;
      return done;
    }, "the hosted research order");
    // Started custom matches leave the front page: an outsider sees neither the room nor the match.
    now += 1_000;
    await until(() => latestDirectory(2).now >= now - 1_000 && latestDirectory(2).state.rooms.every((room) => room.kind === "default"), "the outsider directory");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(latestDirectory(2).activeMatches ?? []).toEqual([]);
    expect(latestDirectory(1).activeMatches?.map((match) => match.hosted)).toEqual([true]);
    // The host leaving ends the match for everyone and frees the reservation.
    host!.socket.close();
    await until(() => [0, 1].every((index) => all[index].some((message) => message.type === "match-ended")), "the match end");
    for (const index of [0, 1]) {
      const ended = all[index].find((message) => message.type === "match-ended")!;
      expect(ended.type === "match-ended" && ended.message).toBe(HOST_LEFT_MESSAGE);
    }
    await until(() => coordinator.rooms.snapshot().reservations.length === 0, "the released reservation");
  } finally {
    for (const client of clients) client.terminate();
    host?.socket.terminate();
    await coordinator.close();
    store.close();
  }
}, 60_000);

it("refuses a /host connection from anyone but the match's host", async () => {
  const origin = "http://localhost:9010";
  const store = new CoordinatorStore(":memory:");
  const coordinator = createCoordinatorServer({ store, origins: [origin], matchCapacity: 0 });
  await new Promise<void>((resolve) => coordinator.http.listen(0, "127.0.0.1", resolve));
  const port = (coordinator.http.address() as { port: number }).port;
  try {
    const stranger = store.createGuest();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/host`, { origin });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
    await new Promise<void>((resolve) => socket.on("open", resolve));
    socket.send(JSON.stringify({ type: "host-authenticate", token: stranger.token, matchId: "match-1", runtimeId: "x" }));
    expect(await closed).toEqual({ code: 1008, reason: "This browser is not the host of that match" });
  } finally {
    await coordinator.close();
    store.close();
  }
});
