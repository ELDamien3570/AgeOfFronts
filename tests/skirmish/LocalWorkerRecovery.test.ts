import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import type { WorkerRequest, WorkerResponse } from "../../src/skirmish/Protocol";
const last = <T>(items: readonly T[]): T => items[items.length - 1];

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

async function fixture() {
  vi.useFakeTimers();
  const messages: WorkerResponse[] = [];
  const worker = { onmessage: undefined as undefined | ((e: { data: WorkerRequest }) => void),
    postMessage: (message: WorkerResponse) => messages.push(structuredClone(message)) };
  vi.stubGlobal("self", worker);
  await import("../../src/skirmish/worker");
  const post = (data: WorkerRequest) => worker.onmessage!({ data });
  post({ type: "start", width: 64, height: 48, terrain: new Uint8Array(64 * 48).fill(133),
    options: { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" } });
  await vi.advanceTimersByTimeAsync(10050);
  const states = () => messages.filter((m): m is Extract<WorkerResponse, { type: "state" }> => m.type === "state");
  return { post, states, messages };
}

describe("local worker recovery boundaries", () => {
  it("acknowledges diagnostic orders at the current simulation tick", async () => {
    const f = await fixture();
    f.post({ type: "start", width: 64, height: 48, terrain: new Uint8Array(64 * 48).fill(133), diagnostics: true,
      options: { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" } });
    await vi.advanceTimersByTimeAsync(10050);
    f.post({ type: "resync" });
    const current = new SnapshotDecoder().decodeLatest(last(f.states()).packet);
    const squad = current.squads.find(s => s.playerId === 1)!;
    f.post({ type: "command", diagnosticId: 7, command: { type: "order", playerId: 1, squadIds: [squad.id], order: { type: "hold" } } });
    expect(f.messages).toContainEqual({ type: "command-admitted", diagnosticId: 7, tick: current.tick, rejected: false });
  });
  it("publishes a complete reset at the same tick without changing paused state or speed", async () => {
    const f = await fixture();
    f.post({ type: "speed", speed: 4 });
    await vi.advanceTimersByTimeAsync(50);
    f.post({ type: "pause", paused: true });
    const before = last(f.states());
    expect(before.packet.reset).toBe(false);
    f.post({ type: "resync" });
    const reset = last(f.states());
    expect(reset).toMatchObject({ paused: true, speed: 4, packet: { reset: true, tick: before.packet.tick } });
    const decoder = new SnapshotDecoder();
    const recovered = decoder.decodeLatest(reset.packet);
    expect(recovered.tick).toBe(before.packet.tick);
    const squad = recovered.squads.find(s => s.playerId === 1)!;
    f.post({ type: "command", command: { type: "order", playerId: 1, squadIds: [squad.id], order: { type: "hold", facing: Math.PI } } });
    const order = decoder.decodeLatest(last(f.states()).packet).squads.find(s => s.id === squad.id)!.order;
    expect(order.type).toBe("hold");
    expect(order.type === "hold" && order.facing).toBeCloseTo(Math.PI, 6);
    f.post({ type: "pause", paused: false });
    await vi.advanceTimersByTimeAsync(50);
    const after = last(f.states());
    expect(after.packet.reset).toBe(false);
    expect(decoder.decodeLatest(after.packet).tick).toBe(before.packet.tick + 4);
  });

  it("reports a simulation failure with its tick and stops further advancement", async () => {
    const f = await fixture();
    const currentTick = last(f.states()).packet.tick;
    // resetModules gives the worker a fresh constructor instance.
    const runtime = await import("../../src/skirmish/Simulation");
    vi.spyOn(runtime.Skirmish.prototype, "step").mockImplementation(() => { throw new Error("fixture failure"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(50);
    const error = last(f.messages);
    expect(error).toEqual({ type: "error", message: `The match stopped at tick ${currentTick}: fixture failure` });
    const count = f.messages.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.messages).toHaveLength(count);
  });
});
