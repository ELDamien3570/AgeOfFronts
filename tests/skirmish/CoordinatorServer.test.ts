import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";
import type { MatchExecutor } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { decodeSnapshotFrame } from "../../src/skirmish/multiplayer/SnapshotWireCodec";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";

const origin = "http://127.0.0.1:9010";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function start(store = new CoordinatorStore(":memory:"), now?: () => number, executor?: MatchExecutor) {
  const server = createCoordinatorServer({ store, origins: [origin], now, ...(executor ? { matchCapacity: 1, createExecutor: () => executor } : {}) });
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
async function client(socket: string, token: string, binarySnapshots = false) {
  const ws = new WebSocket(socket, { origin });
  const messages: ServerMessage[] = [];
  const binaryFrames: ServerMessage[] = [];
  ws.on("message", (data, binary) => {
    const message = binary ? decodeSnapshotFrame(Uint8Array.from(data as Buffer).buffer) : JSON.parse(data.toString()) as ServerMessage;
    messages.push(message); if (binary) binaryFrames.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", token, ...(binarySnapshots ? { snapshotTransport: "binary-v1" } : {}) }));
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
  return { ws, next, binaryFrames };
}

describe("durable authenticated lobby transport", () => {
  it("negotiates binary live states and keeps legacy text clients on the same publication and recovery baseline", async () => {
    let clock=1000;
    const value={tick:0,owners:new Uint8Array([1,2,0])},packet=await encodeState(value,undefined,{},true);
    const executor:MatchExecutor={async request(request){
      const result=request.type==="prepare"?{mapHash:"map",options:request.options}:
        request.type==="spawn-state"?{remainingMs:request.remainingMs}:
        request.type==="client-baseline"?{tick:0,winner:null,baseline:packet}:
        request.type==="baseline"?packet:{tick:0,winner:null,packet,rejectedCommands:[]};
      return result as never;
    },async close(){}};
    const {url,socket,store}=await start(undefined,()=>clock,executor);cleanups.unshift(()=>store.close());
    const a=await guest(url),b=await guest(url),first=await client(socket,a.token,true),second=await client(socket,b.token);
    first.ws.send(JSON.stringify({type:"create",requestId:"binary-room",title:"Binary compatibility",settings:defaultLobbySettings("africa"),willingToWait:false}));
    const created=await first.next(m=>m.type==="ack"&&m.requestId==="binary-room"),roomId=created.type==="ack"?created.roomId!:"";
    second.ws.send(JSON.stringify({type:"join",requestId:"binary-join",roomId}));await second.next(m=>m.type==="ack"&&m.requestId==="binary-join");
    for(const [i,peer] of [first,second].entries())peer.ws.send(JSON.stringify({type:"voteStart",requestId:`vote-${i}`,roomId}));
    const manifests=await Promise.all([first.next(m=>m.type==="match"),second.next(m=>m.type==="match")]);
    for(const [i,peer] of [first,second].entries()){
      const message=manifests[i];if(message.type!=="match")throw new Error("Missing manifest");
      peer.ws.send(JSON.stringify({type:"match-ready",requestId:`ready-${i}`,matchId:message.manifest.id,runtimeId:message.manifest.runtimeId,flowControl:true}));
      await peer.next(m=>m.type==="ack"&&m.requestId===`ready-${i}`);
    }
    await first.next(m=>m.type==="match-spawn");clock+=10_000;
    const [binary,text]=await Promise.all([first.next(m=>m.type==="match-state"),second.next(m=>m.type==="match-state")]);
    if(binary.type!=="match-state"||text.type!=="match-state")throw new Error("Missing state");
    expect(first.binaryFrames).toHaveLength(1);expect(second.binaryFrames).toHaveLength(0);
    expect(binary.packet.binary).toBeInstanceOf(Uint8Array);expect(text.packet.binary).toBeUndefined();
    expect(binary.packet.hash).toBe(text.packet.hash);expect(await decodeState(binary.packet)).toEqual(await decodeState(text.packet));
    expect(binary.publicationSequence).toBe(text.publicationSequence);
    first.ws.send(JSON.stringify({type:"match-state-applied",requestId:"binary-applied",matchId:binary.matchId,publicationSequence:binary.publicationSequence,flowEpoch:binary.flowEpoch}));
    await first.next(m=>m.type==="ack"&&m.requestId==="binary-applied");
    first.ws.send(JSON.stringify({type:"match-state-resync",requestId:"binary-resync",matchId:binary.matchId}));
    const recovery=await first.next(m=>m.type==="match-state"&&m.rebase===true);
    expect(recovery.type==="match-state"&&recovery.packet.binary).toBeInstanceOf(Uint8Array);
    expect(recovery.type==="match-state"&&await decodeState(recovery.packet)).toEqual(value);
  },15_000);
  it("rejects rapid recruitment without disconnecting or starving state receipts", async () => {
    let clock = Date.now();
    const { url, socket, store } = await start(undefined, () => clock);
    cleanups.unshift(() => store.close());
    const identity = await guest(url);
    const peer = await client(socket, identity.token);
    for (let i = 0; i < 150; i++) peer.ws.send(JSON.stringify({
      type: "match-command", requestId: `spam-${i}`, matchId: "missing-match",
      command: { type: "recruit", playerId: 1, buildingId: 1,
        definitionId: "stoneage-infantry" },
    }));
    const rejected = await peer.next(m => m.type === "error" && m.requestId === "spam-149");
    expect(rejected.type === "error" && rejected.message).toContain("Request rate exceeded");
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
    for (const type of ["match-state-applied", "match-sync-applied"] as const) {
      peer.ws.send(JSON.stringify({ type, requestId: type, matchId: "missing-match",
        publicationSequence: 1, ...(type === "match-state-applied" ? {flowEpoch: 1} : {syncId: "sync-one"}) }));
      const receipt = await peer.next(m => m.type === "error" && m.requestId === type);
      expect(receipt.type === "error" && receipt.message).toContain("This match is no longer available");
    }
    clock += 1001;
    peer.ws.send(JSON.stringify({ type: "join", requestId: "after-cooldown", roomId: "default-africa" }));
    expect((await peer.next(m => m.type === "ack" && m.requestId === "after-cooldown")).type).toBe("ack");
    expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  });
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
