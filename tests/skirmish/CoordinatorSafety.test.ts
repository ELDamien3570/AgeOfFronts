import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { ExecutorRequest, MatchExecutor } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { HOST_UNAVAILABLE_MESSAGE, MATCH_INITIALIZATION_FAILED_MESSAGE, MATCH_STOPPED_MESSAGE } from "../../src/skirmish/multiplayer/application/TerminalMessages";
import { LOBBY_MAP_IDS } from "../../src/skirmish/lobby/LobbyRules";
import { HostExecutor } from "../../src/skirmish/multiplayer/infrastructure/HostExecutor";
import { createCoordinatorServer, type CoordinatorServerOptions } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";

const origin = "http://127.0.0.1:9011";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function start(options: Partial<CoordinatorServerOptions> = {}) {
  const store = new CoordinatorStore(":memory:");
  const server = createCoordinatorServer({ store, origins: [origin], ...options });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const port = (server.http.address() as { port: number }).port;
  cleanups.push(() => store.close());
  cleanups.push(() => server.close());
  return { server, store, url: `http://127.0.0.1:${port}`, socket: `ws://127.0.0.1:${port}/socket` };
}
async function guest(url: string) {
  const response = await fetch(`${url}/guest`, { method: "POST", headers: { Origin: origin } });
  expect(response.status).toBe(200);
  return (await response.json()) as { guestId: string; token: string };
}
async function open(socket: string, options: { autoPong?: boolean; headers?: Record<string, string> } = {}) {
  const ws = new WebSocket(socket, { origin, ...options });
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("unexpected-response", () => reject(new Error("Upgrade refused")));
    ws.once("close", () => reject(new Error("Closed before open")));
  });
  cleanups.push(() => { ws.terminate(); });
  const next = async (predicate: (message: ServerMessage) => boolean, timeoutMs = 2000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for coordinator message");
  };
  return { ws, messages, next, closed };
}
async function client(socket: string, token: string, options: { autoPong?: boolean } = {}) {
  const peer = await open(socket, options);
  peer.ws.send(JSON.stringify({ type: "authenticate", token }));
  await peer.next((message) => message.type === "directory");
  return peer;
}
type Peer = Awaited<ReturnType<typeof client>>;
const baseExecutor = (override: (request: ExecutorRequest) => unknown = () => undefined): MatchExecutor => ({
  async request(request) {
    const custom = override(request);
    if (custom !== undefined) return (await custom) as never;
    const packet = { hash: "0".repeat(64), payload: "test" };
    const result = request.type === "prepare" ? { mapHash: "map", options: request.options }
      : request.type === "spawn-state" ? { remainingMs: request.remainingMs }
        : { tick: 0, winner: null, packet, rejectedCommands: [] };
    return result as never;
  },
  async close() {},
});
/** Two guests in the public lobby (server simulated) or a custom room (hosted
 * by its creator) vote to start; returns once the match is reserved. */
async function reserveMatch(url: string, socket: string, kind: "public" | "custom" = "public") {
  const a = await guest(url), b = await guest(url);
  const first = await client(socket, a.token), second = await client(socket, b.token);
  let roomId = `default-${LOBBY_MAP_IDS[0]}`;
  if (kind === "custom") {
    first.ws.send(JSON.stringify({ type: "create", requestId: "room", title: "Safety", settings: defaultLobbySettings("africa") }));
    const created = await first.next((m) => m.type === "ack" && m.requestId === "room");
    roomId = created.type === "ack" ? created.roomId! : "";
  } else {
    first.ws.send(JSON.stringify({ type: "join", requestId: "first-join", roomId }));
    await first.next((m) => m.type === "ack" && m.requestId === "first-join");
  }
  second.ws.send(JSON.stringify({ type: "join", requestId: "join", roomId }));
  await second.next((m) => m.type === "ack" && m.requestId === "join");
  for (const [i, peer] of [first, second].entries())
    peer.ws.send(JSON.stringify({ type: "voteStart", requestId: `vote-${i}`, roomId }));
  return { a, b, first, second, roomId };
}
async function readyBoth(first: Peer, second: Peer) {
  const manifests = await Promise.all([first.next((m) => m.type === "match"), second.next((m) => m.type === "match")]);
  for (const [i, peer] of [first, second].entries()) {
    const message = manifests[i];
    if (message.type !== "match") throw new Error("Missing manifest");
    peer.ws.send(JSON.stringify({ type: "match-ready", requestId: `ready-${i}`, matchId: message.manifest.id, runtimeId: message.manifest.runtimeId }));
    await peer.next((m) => m.type === "ack" && m.requestId === `ready-${i}`);
  }
}

describe("frame admission before parsing (M5)", () => {
  it("rejects a 512 KB junk frame without ever parsing it", async () => {
    const { url, socket } = await start();
    const peer = await client(socket, (await guest(url)).token);
    const parse = vi.spyOn(JSON, "parse");
    cleanups.push(() => parse.mockRestore());
    peer.ws.send("x".repeat(511_000)); // "512 KB": under the old 512_000-byte transport cap.
    const closed = await peer.closed;
    expect([1006, 1009]).toContain(closed.code);
    expect(parse.mock.calls.some(([text]) => typeof text === "string" && text.length > 128_000)).toBe(false);
  });
  it("rejects an oversized unauthenticated frame before parsing", async () => {
    const { socket } = await start();
    const peer = await open(socket);
    const parse = vi.spyOn(JSON, "parse");
    cleanups.push(() => parse.mockRestore());
    peer.ws.send(JSON.stringify({ type: "authenticate", token: "t".repeat(64 * 1024) }));
    expect((await peer.closed).code).toBe(1008);
    expect(parse.mock.calls.some(([text]) => typeof text === "string" && text.length > 4096)).toBe(false);
  });
  it("refuses large frames beyond the per-session byte budget without parsing them", async () => {
    const { url, socket } = await start({ now: () => 5_000 });
    const peer = await client(socket, (await guest(url)).token);
    const parse = vi.spyOn(JSON, "parse");
    cleanups.push(() => parse.mockRestore());
    const frame = JSON.stringify({ type: "profile", requestId: "big", profile: { name: "A", flagCode: null }, pad: "p".repeat(100_000) });
    for (let i = 0; i < 8; i++) peer.ws.send(frame);
    const refused = await peer.next((m) => m.type === "error" && m.requestId === undefined && m.message.includes("rate"));
    expect(refused.type).toBe("error");
    expect(parse.mock.calls.filter(([text]) => typeof text === "string" && text.length > 100_000).length).toBeLessThan(8);
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  });
  it("sends one frame-rate notice per window, not one reply per dropped frame", async () => {
    const { url, socket } = await start({ now: () => 7_000 });
    const peer = await client(socket, (await guest(url)).token);
    for (let i = 0; i < 600; i++)
      peer.ws.send(JSON.stringify({ type: "match-command", requestId: `f-${i}`, matchId: "missing", command: { type: "recruit" } }));
    // A marker after the flood: the socket stays open (one violation) and is
    // still answered by the request gate, so every earlier reply has arrived.
    await peer.next((m) => m.type === "error" && m.requestId === "f-199");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const notices = peer.messages.filter((m) => m.type === "error" && m.requestId === undefined &&
      m.message.startsWith("Request rate exceeded"));
    expect(notices).toHaveLength(1);
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  });
  it("closes a socket that exceeds the request rate in three consecutive windows, not after one burst", async () => {
    let clock = 10_000;
    const { url, socket } = await start({ now: () => clock });
    const peer = await client(socket, (await guest(url)).token);
    const burst = (tag: string) => {
      for (let i = 0; i < 60; i++) peer.ws.send(JSON.stringify({ type: "match-command", requestId: `${tag}-${i}`, matchId: "missing", command: { type: "recruit" } }));
    };
    for (const window of [0, 1]) {
      burst(`w${window}`);
      await peer.next((m) => m.type === "error" && m.requestId === `w${window}-59`);
      expect(peer.ws.readyState).toBe(WebSocket.OPEN);
      clock += 1_001;
    }
    burst("w2");
    expect(await peer.closed).toMatchObject({ code: 1008, reason: "Rate limit exceeded" });
  });
  it("forgives an earlier violation after a quiet window", async () => {
    let clock = 10_000;
    const { url, socket } = await start({ now: () => clock });
    const peer = await client(socket, (await guest(url)).token);
    for (const window of [0, 1, 2]) {
      for (let i = 0; i < 60; i++) peer.ws.send(JSON.stringify({ type: "match-command", requestId: `q${window}-${i}`, matchId: "missing", command: { type: "recruit" } }));
      await peer.next((m) => m.type === "error" && m.requestId === `q${window}-59`);
      clock += window === 0 ? 2_500 : 1_001; // A quiet window resets the streak.
    }
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  });
  it("caps concurrent sockets per client address", async () => {
    const { socket } = await start({ maxSocketsPerAddress: 2 });
    const first = await open(socket), second = await open(socket);
    await expect(open(socket)).rejects.toThrow();
    first.ws.close();
    await first.closed;
    await vi.waitFor(async () => { const again = await open(socket); again.ws.terminate(); }, { timeout: 2000 });
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("per-address cap behind a trusted proxy (M5)", () => {
  it("counts the forwarded client address, not the proxy's", async () => {
    const { socket } = await start({ maxSocketsPerAddress: 1, trustProxy: true });
    const via = (address: string) => open(socket, { headers: { "X-Forwarded-For": `198.51.100.7, ${address}` } });
    await via("203.0.113.1");
    await via("203.0.113.2");
    await expect(via("203.0.113.1")).rejects.toThrow();
  });
});

describe("heartbeat tolerance (P18)", () => {
  it("tolerates two missed pongs and drops the socket on the third", async () => {
    const { url, socket } = await start({ heartbeatMs: 60 });
    const peer = await client(socket, (await guest(url)).token, { autoPong: false });
    const started = Date.now();
    const closed = await peer.closed;
    // Pings at 1, 2 and 3 intervals go unanswered; the fourth tick terminates.
    expect(Date.now() - started).toBeGreaterThanOrEqual(3 * 60 - 20);
    expect(closed.code).toBe(1006);
  });
  it("keeps responsive clients, and a client that resumes answering, connected", async () => {
    const { url, socket } = await start({ heartbeatMs: 40 });
    const responsive = await client(socket, (await guest(url)).token);
    const late = await client(socket, (await guest(url)).token, { autoPong: false });
    let pings = 0;
    // Misses two pings, then answers every later one.
    late.ws.on("ping", () => { if (++pings >= 3) late.ws.pong(); });
    // Wait for the pings themselves, not a fixed wall-clock span: under
    // full-suite load the 40 ms heartbeat timer can fire far less often.
    const deadline = Date.now() + 20_000;
    while (pings < 5 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pings).toBeGreaterThanOrEqual(5);
    expect(responsive.ws.readyState).toBe(WebSocket.OPEN);
    expect(late.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("coordinator terminal messages (L11)", () => {
  it("ends a match whose worker throws with a fixed string, never the internal text", async () => {
    let clock = 1000;
    const raw = "Cannot read properties of undefined (reading 'kind')";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => log.mockRestore());
    const executor = baseExecutor((request) => request.type === "advance" ? Promise.reject(new TypeError(raw)) : undefined);
    const { url, socket } = await start({ now: () => clock, matchCapacity: 1, createExecutor: () => executor });
    const { first, second } = await reserveMatch(url, socket);
    await readyBoth(first, second);
    await first.next((m) => m.type === "match-spawn");
    clock += 10_000;
    await first.next((m) => m.type === "match-state");
    clock += 1_000;
    const ended = await Promise.all([first, second].map((peer) => peer.next((m) => m.type === "match-ended")));
    for (const message of ended) {
      expect(message.type === "match-ended" && message.message).toBe(MATCH_STOPPED_MESSAGE);
      expect(JSON.stringify(message)).not.toContain("reading");
    }
    expect(log).toHaveBeenCalled();
  });
});

describe("failed match initialization (M7 / B-2)", () => {
  it("returns every member to the public lobby with a visible, fixed error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => log.mockRestore());
    const executor = baseExecutor((request) => request.type === "prepare"
      ? Promise.reject(new Error("ENOENT: /srv/maps/africa.bin")) : undefined);
    const { url, socket, server } = await start({ matchCapacity: 1, createExecutor: () => executor });
    const { a, b, first, second, roomId } = await reserveMatch(url, socket);
    const errors = await Promise.all([first, second].map((peer) =>
      peer.next((m) => m.type === "error" && m.requestId === undefined, 3000)));
    for (const message of errors) expect(message.type === "error" && message.message).toBe(MATCH_INITIALIZATION_FAILED_MESSAGE);
    for (const message of errors) expect(JSON.stringify(message)).not.toContain("ENOENT");
    await vi.waitFor(() => expect(server.rooms.snapshot().reservations).toHaveLength(0));
    const room = server.rooms.snapshot().rooms.find((candidate) => candidate.id === roomId)!;
    expect(room.members.map((member) => member.guestId).sort()).toEqual([a.guestId, b.guestId].sort());
    expect(room.members.every((member) => member.connected && !member.votedToStart)).toBe(true);
    // The failed start released capacity: no next-battlefield vote replaced the lobby.
    expect(server.rooms.snapshot().mapVote).toBeUndefined();
  });
  it("returns every member to the original custom room when the host's browser never opens the match", async () => {
    const { url, socket, server } = await start({ createHostExecutor: (hostId) => new HostExecutor(hostId, { attachTimeoutMs: 200 }) });
    const { a, b, first, second, roomId } = await reserveMatch(url, socket, "custom");
    // The owner is asked to host; nothing opens the /host connection.
    expect((await first.next((m) => m.type === "host-match")).type).toBe("host-match");
    const errors = await Promise.all([first, second].map((peer) =>
      peer.next((m) => m.type === "error" && m.requestId === undefined, 3000)));
    for (const message of errors) expect(message.type === "error" && message.message).toBe(HOST_UNAVAILABLE_MESSAGE);
    await vi.waitFor(() => expect(server.rooms.snapshot().reservations).toHaveLength(0));
    const room = server.rooms.snapshot().rooms.find((candidate) => candidate.id === roomId);
    expect(room).toBeDefined();
    expect(room!.members.map((member) => member.guestId).sort()).toEqual([a.guestId, b.guestId].sort());
    expect(room!.members.every((member) => member.connected && !member.votedToStart)).toBe(true);
    expect(room!.ownerId).toBe(a.guestId);
    const directory = await first.next((m) => m.type === "directory" && m.state.rooms.some((candidate) => candidate.id === roomId));
    expect(directory.type === "directory" && directory.state.reservations).toHaveLength(0);
  });
});
