import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeHostFrame, encodeHostFrame } from "../../src/skirmish/multiplayer/HostWire";
import { HostExecutor, type HostLink } from "../../src/skirmish/multiplayer/infrastructure/HostExecutor";
import type { MatchPublication } from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { HOST_LEFT_MESSAGE, HOST_UNAVAILABLE_MESSAGE, publicInitializationMessage, publicStopMessage } from "../../src/skirmish/multiplayer/application/TerminalMessages";

afterEach(() => vi.useRealTimers());

/** A host link that records the frames the coordinator sent. */
function link() {
  const sent: { id: number; request: { type: string } }[] = [];
  const value: HostLink & { sent: typeof sent; closed: boolean } = {
    sent,
    closed: false,
    send: (frame) => sent.push(decodeHostFrame(frame) as (typeof sent)[number]),
    close: () => { value.closed = true; },
  };
  return value;
}
const packet = (byte: number) => ({ hash: "h".repeat(64), payload: "", binary: new Uint8Array([byte, 1, 2]) });

describe("host wire frames", () => {
  it("round-trips nested binary values as raw bytes", () => {
    const message = { id: 3, result: { tick: 9, packet: packet(7), baseline: packet(8), list: [new Uint8Array([4, 5])] } };
    const frame = encodeHostFrame(message);
    // The bytes travel raw, not as JSON number arrays or base64.
    expect(frame.byteLength).toBeLessThan(JSON.stringify(message).length + 64);
    const decoded = decodeHostFrame(frame.buffer) as typeof message;
    expect(decoded.result.packet.binary).toBeInstanceOf(Uint8Array);
    expect([...decoded.result.packet.binary]).toEqual([7, 1, 2]);
    expect([...decoded.result.baseline.binary]).toEqual([8, 1, 2]);
    expect([...decoded.result.list[0]]).toEqual([4, 5]);
    expect(decoded.result.tick).toBe(9);
  });
  it("rejects truncated frames and other typed arrays", () => {
    const frame = encodeHostFrame({ binary: new Uint8Array(10) });
    expect(() => decodeHostFrame(frame.subarray(0, frame.byteLength - 3))).toThrow(/section/);
    expect(() => decodeHostFrame(new Uint8Array(2))).toThrow(/size/);
    expect(() => encodeHostFrame({ values: new Float32Array(2) })).toThrow(/Uint8Array/);
  });
});

describe("hosted match executor", () => {
  it("queues requests until the host attaches, then settles results in order", async () => {
    const executor = new HostExecutor("owner");
    const prepare = executor.request({ type: "spawn-state", remainingMs: 5 });
    const host = link();
    executor.attach(host);
    expect(host.sent).toEqual([{ id: 1, request: { type: "spawn-state", remainingMs: 5 } }]);
    expect(() => executor.attach(link())).toThrow(/already has a host/);
    executor.receive({ id: 1, result: { remainingMs: 5, choices: [] } });
    await expect(prepare).resolves.toEqual({ remainingMs: 5, choices: [] });
    const failing = executor.request({ type: "seat-status" });
    executor.receive({ id: 2, error: "This faction is no longer available" });
    await expect(failing).rejects.toThrow("This faction is no longer available");
    await executor.close();
  });
  it("delivers streamed publications in sequence and holds a result behind earlier ones", async () => {
    const executor = new HostExecutor("owner");
    const host = link();
    executor.attach(host);
    const delivered: number[] = [];
    executor.onPublication((publication: MatchPublication) => delivered.push(publication.tick));
    const baseline = executor.request({ type: "baseline" });
    let settled = false;
    void baseline.then(() => { settled = true; });
    // The baseline follows publication 2, which arrives after it.
    executor.receive({ id: 1, result: packet(3), publicationsIssued: 2 });
    executor.receive({ publication: { tick: 10, sequence: 1, packet: packet(1) } });
    await Promise.resolve();
    expect(settled).toBe(false);
    executor.receive({ publication: { tick: 11, sequence: 2, packet: packet(2) } });
    await baseline;
    expect(delivered).toEqual([10, 11]);
    await executor.close();
  });
  it("stops with the host-left message when the host disconnects, sends junk or reports a fatal error", async () => {
    for (const end of ["detach", "junk", "fatal"] as const) {
      const executor = new HostExecutor("owner");
      const host = link();
      executor.attach(host);
      const pending = executor.request({ type: "seat-status" });
      if (end === "detach") executor.detach(host);
      else if (end === "junk") executor.receive({ id: "not-a-number" });
      else executor.receive({ fatal: "Snapshot publication failed" });
      await expect(pending).rejects.toThrow(HOST_LEFT_MESSAGE);
      expect(executor.lifecycle).toMatchObject({ state: "stopped", message: HOST_LEFT_MESSAGE });
      expect(host.closed).toBe(true);
      await expect(executor.request({ type: "seat-status" })).rejects.toThrow(HOST_LEFT_MESSAGE);
    }
  });
  it("gives up when the host never attaches and ignores a stale link", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const executor = new HostExecutor("owner", { attachTimeoutMs: 1_000 });
    const pending = executor.request({ type: "seat-status" });
    const rejected = expect(pending).rejects.toThrow(HOST_LEFT_MESSAGE);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(() => executor.attach(link())).toThrow(/no longer waiting/);
    warn.mockRestore();
  });
  it("shows players fixed host text, never internal errors", () => {
    expect(publicInitializationMessage(new Error(HOST_LEFT_MESSAGE))).toBe(HOST_UNAVAILABLE_MESSAGE);
    expect(publicStopMessage(new Error(HOST_LEFT_MESSAGE))).toBe(HOST_LEFT_MESSAGE);
  });
});
