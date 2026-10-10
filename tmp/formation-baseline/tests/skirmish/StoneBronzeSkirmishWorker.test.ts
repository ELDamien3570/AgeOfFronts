import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import type {
  Snapshot,
  WorkerRequest,
  WorkerResponse,
} from "../../src/skirmish/Protocol";
import { SnapshotDecoder } from "../../src/skirmish/SnapshotCodec";
import { STONE_BRONZE_OPTIONS } from "./browser/StoneBronzeSkirmishRoster";
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("Stone/Bronze demo through the normal worker", () => {
  it("starts through spawn selection, accepts movement, pauses, and restarts in Bronze", async () => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "performance"],
    });
    const messages: WorkerResponse[] = [];
    const worker: {
      onmessage?: (event: MessageEvent<WorkerRequest>) => void;
      postMessage(message: WorkerResponse): void;
    } = {
      postMessage: (message) => messages.push(structuredClone(message)),
    };
    vi.stubGlobal("self", worker);
    await import("../../src/skirmish/worker");
    const send = (data: WorkerRequest) =>
      worker.onmessage!({ data } as MessageEvent<WorkerRequest>);
    let decoder = new SnapshotDecoder();
    const latest = (): Snapshot => {
      let snapshot: Snapshot | undefined;
      for (const message of messages.splice(0)) {
        if (message.type === "error" || message.type === "rejected")
          throw new Error(message.message);
        if (message.type === "state") snapshot = decoder.decode(message.packet);
      }
      if (!snapshot) throw new Error("No worker state published");
      return snapshot;
    };
    const start = (startingAge: "StoneAge" | "BronzeAge") =>
      send({
        type: "start",
        width: 48,
        height: 48,
        terrain: new Uint8Array(48 * 48).fill(133),
        options: {
          seed: 42,
          aiCount: 1,
          tribes: false,
          ruleset: "ages-v1",
          startingAge,
          ...DEFAULT_AI_POLICIES,
          ...STONE_BRONZE_OPTIONS,
        },
      });
    start("StoneAge");
    expect(messages[0].type).toBe("spawn");
    await vi.advanceTimersByTimeAsync(10000);
    let snapshot = latest();
    expect(snapshot.expansion!.maximumAge).toBe("BronzeAge");
    expect(snapshot.players.filter((p) => p.kind === "regular")).toHaveLength(
      2,
    );
    const squad = snapshot.squads.find((s) => s.playerId === 1)!;
    expect(squad).toBeTruthy();
    const tile = Math.min(48 * 48 - 1, snapshot.players[0].base + 48 * 3 + 3);
    send({
      type: "command",
      command: {
        type: "order",
        playerId: 1,
        squadIds: [squad.id],
        order: { type: "move", tile },
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    snapshot = latest();
    expect(snapshot.tick).toBeGreaterThanOrEqual(20);
    expect(
      snapshot.squads.find((s) => s.id === squad.id)!.locomotion,
    ).toBeTruthy();
    send({ type: "pause", paused: true });
    const pausedTick = latest().tick;
    await vi.advanceTimersByTimeAsync(500);
    expect(messages.filter((m) => m.type === "state")).toHaveLength(0);
    send({ type: "pause", paused: false });
    expect(latest().tick).toBe(pausedTick);
    await vi.advanceTimersByTimeAsync(50);
    expect(latest().tick).toBe(pausedTick + 1);
    messages.length = 0;
    decoder = new SnapshotDecoder();
    start("BronzeAge");
    await vi.advanceTimersByTimeAsync(10000);
    snapshot = latest();
    expect(snapshot.tick).toBe(0);
    expect(
      Object.values(snapshot.expansion!.progression).every(
        (p) => p.age === "BronzeAge",
      ),
    ).toBe(true);
  });
});
