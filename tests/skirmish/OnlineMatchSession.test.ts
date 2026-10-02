import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LoadedMap,
  SnapshotPacket,
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
  onmessage?: (event: { data: { packet: SnapshotPacket } }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(readonly url: URL) {
    DecoderWorker.instances.push(this);
  }
  deliver(packet: SnapshotPacket) {
    this.onmessage?.({ data: { packet } });
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
const state = (tick: number): ServerMessage => ({
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
  it("loads presentation, disables rejoin and declares readiness without starting a simulation", async () => {
    await initialize();
    expect(connection().options).toEqual({ reconnect: false });
    expect(connection().request).toHaveBeenCalledWith({
      type: "match-ready",
      matchId: manifest.id,
      runtimeId: manifest.runtimeId,
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
  it("ends this client's participation if updates outpace decoding, rather than accumulating indefinitely", async () => {
    await initialize();
    for (let i = 0; i < 9; i++) connection().message(state(i * 4));
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("cannot keep up"),
        }),
      ),
    );
    expect(connection().stop).toHaveBeenCalledTimes(1);
    expect(DecoderWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(updates).not.toHaveBeenCalled();
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
