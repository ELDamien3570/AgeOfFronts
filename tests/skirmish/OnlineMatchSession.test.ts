import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LoadedMap,
  SnapshotPacket,
  Snapshot,
  WorkerResponse,
} from "../../src/skirmish/Protocol";
import { OnlineMatchSession } from "../../src/skirmish/client/OnlineMatchSession";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import type {
  MatchManifest,
  ServerMessage,
} from "../../src/skirmish/multiplayer/Protocol";

const mocks = vi.hoisted(() => ({
  connections: [] as any[],
  identity: vi.fn(async () => "map-hash"),
}));
vi.mock("../../src/skirmish/multiplayer/application/MapIdentity", () => ({
  mapIdentity: mocks.identity,
}));
vi.mock("../../src/skirmish/client/lobby/OnlineLobbyConnection", () => ({
  OnlineLobbyConnection: class {
    request = vi.fn(async (_message: unknown) => undefined);
    stop = vi.fn();
    connect = vi.fn(async () => {});
    constructor(
      _endpoint: string,
      readonly directory: (message: unknown) => void,
      readonly status: (message: string, connected: boolean) => void,
      readonly message: (message: ServerMessage) => void,
      readonly options: unknown,
    ) {
      mocks.connections.push(this);
    }
  },
}));

class DecoderWorker {
  static instances: DecoderWorker[] = [];
  onmessage?: (event: { data: { packet: SnapshotPacket;snapshot?:Snapshot;canonicalSequence?:number } }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(readonly url: URL) {
    DecoderWorker.instances.push(this);
  }
  deliver(packet: SnapshotPacket,snapshot?:Snapshot,canonicalSequence?:number) {
    this.onmessage?.({ data: { packet,snapshot,canonicalSequence } });
  }
}
const manifest: MatchManifest = {
  id: "match-one",
  settings: defaultLobbySettings("africa", 250),
  options: { seed: 42, humanNames: ["A", "B"], aiCount: 0 },
  runtimeId: import.meta.env.VITE_SKIRMISH_RUNTIME_ID,
  mapHash: "map-hash",
  playerId: 2,
};
const loaded = {
  map: { width: () => 160, height: () => 100 },
  terrain: new Uint8Array(16000),
} as unknown as LoadedMap;
const packet = (tick: number, reset = tick === 0) =>
  ({ tick, reset }) as SnapshotPacket;
const state = (
  tick: number,
): Extract<ServerMessage, { type: "match-state" }> => ({
  type: "match-state",
  matchId: manifest.id,
  tick,
  packet: { hash: "a".repeat(64), payload: "encoded" },
  paused: false,
  executor: "server",
  disconnectedPlayerIds: [],
});
let session: OnlineMatchSession;
const errors = vi.fn<(event: { message: string }) => void>();
const status = vi.fn<(message: string) => void>();
const updates = vi.fn<(event: MessageEvent<WorkerResponse>) => void>();
const connection = () => mocks.connections[mocks.connections.length - 1]!;
async function initialize(load = async () => loaded) {
  session = new OnlineMatchSession(
    "http://localhost",
    manifest.id,
    load,
    vi.fn(),
    status,
  );
  session.onerror = errors;
  session.onmessage = updates;
  connection().message({ type: "match", manifest });
  await vi.waitFor(() =>
    expect(connection().request).toHaveBeenCalledWith(
      expect.objectContaining({ type: "match-ready" }),
    ),
  );
}
beforeEach(() => {
  mocks.connections.length = 0;
  mocks.identity.mockResolvedValue("map-hash");
  DecoderWorker.instances.length = 0;
  vi.stubGlobal("Worker", DecoderWorker);
  errors.mockClear();
  status.mockClear();
  updates.mockClear();
});
afterEach(() => {
  session?.terminate();
  vi.unstubAllGlobals();
});

describe("server-only match client", () => {
  it("separates transport admission from correlated domain results and fences foreign match and faction receipts", async () => {
    await initialize();
    const worker=DecoderWorker.instances[0];
    connection().message(state(0));
    await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(1));
    worker.deliver(packet(0));
    await vi.waitFor(()=>expect(session.commandsAvailable).toBe(true));
    const outcomes=vi.fn();session.oncommandoutcome=outcomes;
    session.postMessage({type:"command",command:{type:"order",playerId:2,squadIds:[5],order:{type:"move",tile:50}}});
    await vi.waitFor(()=>expect(outcomes).toHaveBeenCalledWith(expect.objectContaining({status:"accepted"})));
    const request=connection().request.mock.calls.find((c:any[])=>c[0].type==="match-command")[0];
    const outcome={id:request.requestId,playerId:2,tick:4,status:"deferred" as const};
    connection().message({type:"match-command-outcome",matchId:"foreign",outcome});
    connection().message({type:"match-command-outcome",matchId:manifest.id,outcome:{...outcome,playerId:1}});
    connection().message({type:"match-command-outcome",matchId:manifest.id,outcome});
    connection().message({type:"match-command-outcome",matchId:manifest.id,outcome:{...outcome,tick:8,status:"executed"}});
    await vi.waitFor(()=>expect(outcomes).toHaveBeenCalledTimes(3));
    expect(outcomes.mock.calls.map(c=>c[0].status)).toEqual(["accepted","deferred","executed"]);
    expect(session.lastCommandOutcome).toMatchObject({id:request.requestId,tick:8,status:"executed"});
  });
  it("does not overwrite a completed outcome when its transport ACK resolves late",async()=>{
    await initialize();const worker=DecoderWorker.instances[0];
    connection().message(state(0));await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(1));worker.deliver(packet(0));
    await vi.waitFor(()=>expect(session.commandsAvailable).toBe(true));
    let acknowledge!:()=>void;connection().request.mockImplementationOnce(()=>new Promise<void>(resolve=>{acknowledge=resolve;}));
    const outcomes=vi.fn();session.oncommandoutcome=outcomes;
    session.postMessage({type:"command",command:{type:"order",playerId:2,squadIds:[5],order:{type:"hold"}}});
    const request=connection().request.mock.calls.find((c:any[])=>c[0].type==="match-command")[0];
    connection().message({type:"match-command-outcome",matchId:manifest.id,outcome:{id:request.requestId,playerId:2,tick:1,status:"executed"}});
    await vi.waitFor(()=>expect(outcomes).toHaveBeenCalledTimes(1));acknowledge();await Promise.resolve();await Promise.resolve();
    expect(outcomes).toHaveBeenCalledTimes(1);expect(session.lastCommandOutcome?.status).toBe("executed");
  });
  it("loads presentation without automatic reconnect and declares readiness without starting a simulation", async () => {
    await initialize();
    expect(connection().options).toEqual({ reconnect: false });
    expect(connection().request).toHaveBeenCalledWith({
      type: "match-ready",
      matchId: manifest.id,
      runtimeId: manifest.runtimeId,
      flowControl:true,
      requestId: expect.any(String),
    });
    expect(DecoderWorker.instances).toHaveLength(1);
    expect(DecoderWorker.instances[0].url.pathname).toContain(
      "multiplayerStateWorker.ts",
    );
    expect(DecoderWorker.instances[0].postMessage).not.toHaveBeenCalled();
  });
  it("applies the initial baseline and each ordered update through the decode worker", async () => {
    await initialize();
    const worker = DecoderWorker.instances[0];
    connection().message(state(0));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    worker.deliver(packet(0));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
    connection().message(state(4));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    worker.deliver(packet(4));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(status).toHaveBeenLastCalledWith("Online match · server hosted");
    expect(errors).not.toHaveBeenCalled();
  });
  it("requests a replacement baseline after temporary backlog without losing identity or disconnecting", async () => {
    await initialize();
    for (let i = 0; i < 9; i++) connection().message(state(i * 4));
    await vi.waitFor(()=>expect(connection().request).toHaveBeenCalledWith(expect.objectContaining({type:"match-state-resync"})));
    await vi.waitFor(()=>expect(session.diagnostics.pendingStates).toBe(0));
    expect(connection().stop).not.toHaveBeenCalled();
    expect(DecoderWorker.instances[0].terminate).not.toHaveBeenCalled();
    expect(updates).not.toHaveBeenCalled();
    connection().message({...state(36),publicationSequence:9,flowEpoch:2,rebase:true});
    const worker=DecoderWorker.instances[0];await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(1));
    worker.deliver(packet(36,true));await vi.waitFor(()=>expect(updates).toHaveBeenCalledTimes(1));
    expect(session.commandsAvailable).toBe(true);expect(errors).not.toHaveBeenCalled();
    expect(connection().request).toHaveBeenCalledWith(expect.objectContaining({type:"match-state-applied",flowEpoch:2,publicationSequence:9}));
  });
  it("continues canonical application while presentation is delayed and shows only the newest complete state",async()=>{
    await initialize();const worker=DecoderWorker.instances[0];let finish!:()=>void;
    const presented:number[]=[];
    session.onmessage=event=>{
      if(event.data.type!=="state")return;presented.push(event.data.snapshot!.tick);
      if(presented.length===1)return new Promise<void>(resolve=>{finish=resolve;});
    };
    const view=(tick:number)=>({tick} as Snapshot);
    connection().message(state(0));await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(1));worker.deliver(packet(0),view(0),1);
    await vi.waitFor(()=>expect(presented).toEqual([0]));
    connection().message(state(4));await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(2));worker.deliver(packet(4),view(4),2);
    connection().message(state(8));await vi.waitFor(()=>expect(worker.postMessage).toHaveBeenCalledTimes(3));worker.deliver(packet(8),view(8),3);
    await vi.waitFor(()=>expect(session.diagnostics.pendingStates).toBe(0));expect(presented).toEqual([0]);finish();
    await vi.waitFor(()=>expect(presented).toEqual([0,8]));expect(session.diagnostics.coalesced).toBe(1);
  });
  it("closes cleanly on disconnect and never requests host or recovery operations", async () => {
    await initialize();
    connection().status("Connection lost.", false);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("left this match"),
      }),
    );
    expect(connection().stop).toHaveBeenCalledTimes(1);
    expect(
      connection().request.mock.calls.map((call: any[]) => call[0].type),
    ).toEqual(["match-ready"]);
  });
  it("refuses a delta before the initial baseline", async () => {
    await initialize();
    const worker = DecoderWorker.instances[0];
    connection().message(state(4));
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    worker.deliver(packet(4));
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Invalid match update sequence"),
        }),
      ),
    );
    expect(updates).not.toHaveBeenCalled();
  });
  it("does not construct a worker if loading completes after the session was closed", async () => {
    let finish!: (value: LoadedMap) => void;
    session = new OnlineMatchSession(
      "http://localhost",
      manifest.id,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      vi.fn(),
      status,
    );
    connection().message({ type: "match", manifest });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    session.terminate();
    finish(loaded);
    await Promise.resolve();
    await Promise.resolve();
    expect(DecoderWorker.instances).toHaveLength(0);
    expect(connection().request).not.toHaveBeenCalled();
  });
  it("does not replace the final match status when a pending command rejects during teardown", async () => {
    await initialize();
    connection().message(state(0));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(0));
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
    let reject!: (error: Error) => void;
    connection().request.mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    session.postMessage({
      type: "command",
      command: {
        type: "order",
        playerId: 2,
        squadIds: [1],
        order: { type: "hold" },
      },
    });
    connection().message({
      type: "match-ended",
      matchId: manifest.id,
      message: "Match complete",
    });
    await vi.waitFor(() => expect(connection().stop).toHaveBeenCalled());
    reject(new Error("Lobby connection closed."));
    await Promise.resolve();
    await Promise.resolve();
    expect(status).toHaveBeenLastCalledWith(
      "Match complete. Return to the lobby to play again.",
    );
  });
});

const hold = () =>
  session.postMessage({
    type: "command",
    command: {
      type: "order",
      playerId: 2,
      squadIds: [1],
      order: { type: "hold" },
    },
  });
const syncState = (
  sequence: number,
  tick = 80,
  syncId = "sync-one",
): ServerMessage => ({
  ...state(tick),
  type: "match-state",
  publicationSequence: sequence,
  syncId,
  paused: true,
});
const requested = (type: string) =>
  connection().request.mock.calls.filter(
    (call: any[]) => call[0].type === type,
  );

describe("live admission synchronization", () => {
  it("requests the chosen AI seat once, never deriving ownership from a display name", () => {
    session = new OnlineMatchSession(
      "http://localhost",
      manifest.id,
      async () => loaded,
      vi.fn(),
      status,
      4,
    );
    connection().directory({});
    connection().directory({});
    expect(requested("watch-match")).toHaveLength(1);
    expect(requested("watch-match")[0][0]).toMatchObject({
      matchId: manifest.id,
      playerId: 4,
    });
    expect(session.commandsAvailable).toBe(false);
  });
  it("allows the server to resolve a remembered browser's reserved empire", () => {
    session = new OnlineMatchSession(
      "http://localhost",
      manifest.id,
      async () => loaded,
      vi.fn(),
      status,
    );
    connection().directory({});
    expect(requested("watch-match")[0][0]).not.toHaveProperty("playerId");
  });
  it("acknowledges only after applying the full baseline, then unlocks only on matching completion", async () => {
    await initialize();
    let apply!: () => void;
    session.onmessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          apply = resolve;
        }),
    );
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    hold();
    expect(requested("match-command")).toHaveLength(0);
    expect(requested("match-sync-applied")).toHaveLength(0);
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() => expect(apply).toBeTypeOf("function"));
    expect(requested("match-sync-applied")).toHaveLength(0);
    apply();
    await vi.waitFor(() =>
      expect(requested("match-sync-applied")).toHaveLength(1),
    );
    expect(requested("match-sync-applied")[0][0]).toMatchObject({
      matchId: manifest.id,
      syncId: "sync-one",
      publicationSequence: 20,
    });
    expect(session.commandsAvailable).toBe(false);
    connection().message({
      type: "match-sync-complete",
      matchId: manifest.id,
      syncId: "stale-sync",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.commandsAvailable).toBe(false);
    connection().message({
      type: "match-sync-complete",
      matchId: manifest.id,
      syncId: "sync-one",
    });
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
    hold();
    expect(requested("match-command")).toHaveLength(1);
  });
  it("accepts a fresh publication at the same tick and ignores duplicate publication identities", async () => {
    await initialize();
    connection().message({ ...state(80), publicationSequence: 19 });
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(2),
    );
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() =>
      expect(requested("match-sync-applied")).toHaveLength(1),
    );
    connection().message(syncState(20));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(2);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });
  it("never acknowledges a failed presentation or a non-reset sync packet", async () => {
    await initialize();
    session.onmessage = () => {
      throw new Error("Presentation failed");
    };
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith({ message: "Presentation failed" }),
    );
    expect(requested("match-sync-applied")).toHaveLength(0);
    expect(session.commandsAvailable).toBe(false);
  });
  it("rejects a sync delta even after earlier states have been applied", async () => {
    await initialize();
    connection().message(state(0));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(0));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(2),
    );
    DecoderWorker.instances[0].deliver(packet(80, false));
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(requested("match-sync-applied")).toHaveLength(0);
  });
  it("cancels a baseline application without acknowledging or reopening commands", async () => {
    await initialize();
    let finish!: () => void;
    session.onmessage = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    session.terminate();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested("match-sync-applied")).toHaveLength(0);
    expect(session.commandsAvailable).toBe(false);
  });
  it.each(["error", "match-ended"] as const)(
    "handles %s immediately while assets are still loading",
    async (type) => {
      let finish!: (value: LoadedMap) => void;
      session = new OnlineMatchSession(
        "http://localhost",
        manifest.id,
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        vi.fn(),
        status,
      );
      session.onerror = errors;
      session.onmessage = updates;
      connection().message({ type: "match", manifest });
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      connection().message(
        type === "error"
          ? { type, message: "Loading timed out" }
          : { type, matchId: manifest.id, message: "Match expired" },
      );
      expect(errors).toHaveBeenCalledTimes(1);
      expect(connection().stop).toHaveBeenCalledTimes(1);
      expect(session.commandsAvailable).toBe(false);
      finish(loaded);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(DecoderWorker.instances).toHaveLength(0);
      expect(connection().request).not.toHaveBeenCalled();
      expect(updates).not.toHaveBeenCalled();
    },
  );
  it("handles a sync timeout while baseline presentation is still applying", async () => {
    await initialize();
    let finish!: () => void;
    session.onmessage = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    connection().message(syncState(20));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(80, true));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    connection().message({
      type: "error",
      message: "Synchronization timed out",
    });
    expect(errors).toHaveBeenCalledWith({
      message: "Synchronization timed out",
    });
    expect(connection().stop).toHaveBeenCalledTimes(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requested("match-sync-applied")).toHaveLength(0);
  });
  it("ends a rejected or timed-out admission with a readable error", async () => {
    await initialize();
    connection().message({
      type: "error",
      message: "Synchronization timed out. Please try again.",
    });
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith({
        message: "Synchronization timed out. Please try again.",
      }),
    );
    expect(connection().stop).toHaveBeenCalledTimes(1);
    expect(session.commandsAvailable).toBe(false);
  });
  it("does not drop an established player when an in-flight command rejects during another player's synchronization", async () => {
    await initialize();
    connection().message(state(0));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(0));
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
    connection().message({
      type: "match-status",
      matchId: manifest.id,
      message: "Synchronizing a joining player…",
      paused: true,
    });
    connection().message({ type: "error", message: "Not enough gold" });
    await vi.waitFor(() =>
      expect(status).toHaveBeenLastCalledWith("Not enough gold"),
    );
    expect(errors).not.toHaveBeenCalled();
    expect(connection().stop).not.toHaveBeenCalled();
    expect(session.commandsAvailable).toBe(false);
    connection().message({
      type: "match-status",
      matchId: manifest.id,
      message: "Match resumed",
      paused: false,
    });
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
  });
  it("locks commands for a paused match and resumes from status without a new tick", async () => {
    await initialize();
    connection().message(state(0));
    await vi.waitFor(() =>
      expect(DecoderWorker.instances[0].postMessage).toHaveBeenCalledTimes(1),
    );
    DecoderWorker.instances[0].deliver(packet(0));
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
    connection().message({
      type: "match-status",
      matchId: manifest.id,
      message: "Waiting for a player",
      paused: true,
    });
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(false));
    hold();
    expect(requested("match-command")).toHaveLength(0);
    connection().message({
      type: "match-status",
      matchId: manifest.id,
      message: "Match resumed",
      paused: false,
    });
    await vi.waitFor(() => expect(session.commandsAvailable).toBe(true));
  });
});
