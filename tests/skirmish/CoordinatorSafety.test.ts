import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type { ExecutorRequest, MatchExecutor } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { MATCH_INITIALIZATION_FAILED_MESSAGE, MATCH_STOPPED_MESSAGE } from "../../src/skirmish/multiplayer/application/TerminalMessages";
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
async function open(socket: string, options: { autoPong?: boolean } = {}) {
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
/** Two guests in one custom room vote to start; returns once the match is reserved. */
async function reserveCustomMatch(url: string, socket: string) {
  const a = await guest(url), b = await guest(url);
  const first = await client(socket, a.token), second = await client(socket, b.token);
  first.ws.send(JSON.stringify({ type: "create", requestId: "room", title: "Safety", settings: defaultLobbySettings("africa"), willingToWait: false }));
  const created = await first.next((m) => m.type === "ack" && m.requestId === "room");
  const roomId = created.type === "ack" ? created.roomId! : "";
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

describe("coordinator terminal messages (L11)", () => {
  it("ends a match whose worker throws with a fixed string, never the internal text", async () => {
    let clock = 1000;
    const raw = "Cannot read properties of undefined (reading 'kind')";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => log.mockRestore());
    const executor = baseExecutor((request) => request.type === "advance" ? Promise.reject(new TypeError(raw)) : undefined);
    const { url, socket } = await start({ now: () => clock, matchCapacity: 1, createExecutor: () => executor });
    const { first, second } = await reserveCustomMatch(url, socket);
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
  }, 15_000);
});

describe("failed match initialization (M7 / B-2)", () => {
  it("returns every member to the original custom room with a visible, fixed error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => log.mockRestore());
    const executor = baseExecutor((request) => request.type === "prepare"
      ? Promise.reject(new Error("ENOENT: /srv/maps/africa.bin")) : undefined);
    const { url, socket, server } = await start({ matchCapacity: 1, createExecutor: () => executor });
    const { a, b, first, second, roomId } = await reserveCustomMatch(url, socket);
    const errors = await Promise.all([first, second].map((peer) =>
      peer.next((m) => m.type === "error" && m.requestId === undefined, 3000)));
    for (const message of errors) expect(message.type === "error" && message.message).toBe(MATCH_INITIALIZATION_FAILED_MESSAGE);
    await vi.waitFor(() => expect(server.rooms.snapshot().reservations).toHaveLength(0));
    const room = server.rooms.snapshot().rooms.find((candidate) => candidate.id === roomId);
    expect(room).toBeDefined();
    expect(room!.members.map((member) => member.guestId).sort()).toEqual([a.guestId, b.guestId].sort());
    expect(room!.members.every((member) => member.connected && !member.votedToStart)).toBe(true);
    expect(room!.ownerId).toBe(a.guestId);
    const directory = await first.next((m) => m.type === "directory" && m.state.rooms.some((candidate) => candidate.id === roomId));
    expect(directory.type === "directory" && directory.state.reservations).toHaveLength(0);
  }, 15_000);
});
