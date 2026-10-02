import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnlineLobbyConnection } from "../../src/skirmish/client/lobby/OnlineLobbyConnection";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    Socket.instances.push(this);
  }
}
let connection: OnlineLobbyConnection;
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances.length = 0;
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("localStorage", {
    getItem: () => "a".repeat(43),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  connection?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("bounded match connection", () => {
  it("does not reconnect a disconnected match socket", async () => {
    const status = vi.fn();
    connection = new OnlineLobbyConnection(
      "http://localhost",
      vi.fn(),
      status,
      vi.fn(),
      { reconnect: false },
    );
    await connection.connect();
    Socket.instances[0].onclose?.({ code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(1);
    expect(status).toHaveBeenLastCalledWith(
      expect.stringContaining("Return to the lobby"),
      false,
    );
  });
  it("tells a duplicate tab to keep the original match open", async () => {
    const status = vi.fn();
    connection = new OnlineLobbyConnection("http://localhost", vi.fn(), status);
    await connection.connect();
    Socket.instances[0].onclose?.({ code: 4001, reason: "Match already open" });
    expect(status).toHaveBeenLastCalledWith(
      expect.stringContaining("Keep that tab open"),
      false,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Socket.instances).toHaveLength(1);
  });
  it("keeps lobby reconnection available by default", async () => {
    connection = new OnlineLobbyConnection(
      "http://localhost",
      vi.fn(),
      vi.fn(),
    );
    await connection.connect();
    Socket.instances[0].onclose?.({ code: 1006, reason: "" });
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.instances).toHaveLength(2);
  });
  it("bounds outstanding requests and times them out", async () => {
    connection = new OnlineLobbyConnection(
      "http://localhost",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { reconnect: false },
    );
    await connection.connect();
    const pending = Array.from({ length: 100 }, (_, i) =>
      connection
        .request({ type: "watch-match", requestId: `r-${i}`, matchId: "match" })
        .catch((error) => error.message),
    );
    await expect(
      connection.request({
        type: "watch-match",
        requestId: "overflow",
        matchId: "match",
      }),
    ).rejects.toThrow("Too many pending");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await Promise.all(pending)).toEqual(
      Array(100).fill("The server did not respond in time."),
    );
  });
  it("clears a request deadline when the server acknowledges it", async () => {
    connection = new OnlineLobbyConnection(
      "http://localhost",
      vi.fn(),
      vi.fn(),
    );
    await connection.connect();
    const request = connection.request({
      type: "watch-match",
      requestId: "one",
      matchId: "match",
    });
    Socket.instances[0].onmessage?.({
      data: JSON.stringify({ type: "ack", requestId: "one" }),
    });
    await expect(request).resolves.toBeUndefined();
    connection.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not open a socket after stopping during guest acquisition", async () => {
    const saved = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: saved });
    let finish!: (response: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    connection = new OnlineLobbyConnection(
      "http://localhost",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { reconnect: false },
    );
    const connecting = connection.connect();
    connection.stop();
    finish({ ok: true, json: async () => ({ token: "b".repeat(43) }) });
    await connecting;
    expect(Socket.instances).toHaveLength(0);
    expect(saved).not.toHaveBeenCalled();
  });
});
