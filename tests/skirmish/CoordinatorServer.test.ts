import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";

const origin = "http://127.0.0.1:9010";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function start(store = new CoordinatorStore(":memory:")) {
  const server = createCoordinatorServer({ store, origins: [origin] });
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  const port = (server.http.address() as { port: number }).port;
  cleanups.push(() => server.close());
  return {
    server,
    store,
    url: `http://127.0.0.1:${port}`,
    socket: `ws://127.0.0.1:${port}/socket`,
  };
}
async function guest(url: string) {
  const response = await fetch(`${url}/guest`, {
    method: "POST",
    headers: { Origin: origin },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { guestId: string; token: string };
}
async function client(socket: string, token: string) {
  const ws = new WebSocket(socket, { origin });
  const messages: ServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", token }));
  const next = async (predicate: (message: ServerMessage) => boolean) => {
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for coordinator message");
  };
  await next((message) => message.type === "directory");
  cleanups.push(() => {
    ws.terminate();
  });
  return { ws, next };
}

describe("durable authenticated lobby transport", () => {
  it("shares rooms between independent guests and fences duplicate controlling tabs", async () => {
    const { store, server, url, socket } = await start();
    cleanups.unshift(() => store.close());
    const a = await guest(url),
      b = await guest(url);
    const first = await client(socket, a.token),
      second = await client(socket, b.token);
    first.ws.send(
      JSON.stringify({
        type: "create",
        requestId: "create-one",
        title: "Shared",
        settings: defaultLobbySettings("africa"),
        willingToWait: false,
      }),
    );
    const ack = await first.next((message) => message.type === "ack");
    expect(ack.type).toBe("ack");
    const roomId = ack.type === "ack" ? ack.roomId! : "";
    const directory = await second.next(
      (message) =>
        message.type === "directory" &&
        message.state.rooms.some((room) => room.id === roomId),
    );
    expect(JSON.stringify(directory)).not.toContain(a.token);
    second.ws.send(
      JSON.stringify({ type: "join", requestId: "join-one", roomId }),
    );
    await second.next((message) => message.type === "ack");
    expect(
      server.rooms.snapshot().rooms.find((room) => room.id === roomId)!.members,
    ).toHaveLength(2);
    second.ws.send(JSON.stringify({ type: "voteStart", requestId: "vote-one", roomId }));
    await second.next((message) => message.type === "ack" && message.requestId === "vote-one");
    expect(server.rooms.snapshot().rooms.find((room) => room.id === roomId)!
      .members.find((member) => member.guestId === b.guestId)!.votedToStart).toBe(true);
    second.ws.send(
      JSON.stringify({ type: "close", requestId: "stolen-close", roomId }),
    );
    expect(
      (await second.next((message) => message.type === "error")).type,
    ).toBe("error");
    const oldClosed = new Promise<number>((resolve) =>
      first.ws.once("close", (code) => resolve(code)),
    );
    await client(socket, a.token);
    expect(await oldClosed).toBe(4001);
    expect(
      server.rooms
        .snapshot()
        .rooms.find((room) => room.id === roomId)!
        .members.filter((member) => member.guestId === a.guestId),
    ).toHaveLength(1);
  });

  it("persists guest credentials and idempotent creation across a coordinator restart", async () => {
    const store = new CoordinatorStore(":memory:");
    cleanups.push(() => store.close());
    const firstServer = await start(store);
    const identity = await guest(firstServer.url);
    const first = await client(firstServer.socket, identity.token);
    const request = {
      type: "create",
      requestId: "durable-create",
      title: "Persistent",
      settings: defaultLobbySettings("africa"),
      willingToWait: false,
    };
    first.ws.send(JSON.stringify(request));
    const original = await first.next((message) => message.type === "ack");
    await firstServer.server.close();
    const restarted = await start(store);
    const returned = await client(restarted.socket, identity.token);
    returned.ws.send(JSON.stringify(request));
    expect(await returned.next((message) => message.type === "ack")).toEqual(
      original,
    );
    expect(
      restarted.server.rooms
        .snapshot()
        .rooms.filter((room) => room.kind === "custom"),
    ).toHaveLength(0);
    returned.ws.send(JSON.stringify({type:"join",requestId:"explicit-return",roomId:"default-africa"}));
    await returned.next(message=>message.type==="ack"&&message.requestId==="explicit-return");
    expect(
      restarted.server.rooms
        .snapshot()
        .rooms.find((room) => room.id === "default-africa")!.members[0].connected,
    ).toBe(true);
  });

  it("rejects guest creation from an untrusted origin", async () => {
    const { url, store } = await start();
    cleanups.unshift(() => store.close());
    expect(
      (
        await fetch(`${url}/guest`, {
          method: "POST",
          headers: { Origin: "https://untrusted.invalid" },
        })
      ).status,
    ).toBe(403);
  });
});
