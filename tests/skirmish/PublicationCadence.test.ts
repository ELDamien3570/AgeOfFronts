import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { LiveMatch, PUBLICATION_MIN_INTERVAL_MS } from "../../src/skirmish/multiplayer/application/LiveMatch";
import {
  MATCH_FAULT_CODE,
  type ExecutorRequest,
  type ExecutorResult,
  type MatchExecutor,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";

const packet = { hash: "0".repeat(64), payload: "test" };
const TICK_MS = 1000 / TICKS_PER_SECOND;

/** A fake streaming executor that, like serverMatchWorker under Design B,
 * reports every advance with a command as `commandVisible` and publishes only
 * when the coordinator's gate asks for it. */
async function fixture(options: { faultAtTick?: number } = {}) {
  let now = 0, tick = 0;
  const requests: ExecutorRequest[] = [];
  const messages: ServerMessage[] = [];
  const published: number[] = [];
  let publication: ((value: { tick: number; packet: typeof packet }) => void) | undefined;
  const executor: MatchExecutor = {
    onPublication(listener) { publication = listener; return () => { publication = undefined; }; },
    async request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T> {
      requests.push(request);
      let result: unknown;
      switch (request.type) {
        case "prepare": result = { mapHash: "map", options: request.options }; break;
        case "spawn-state": result = { remainingMs: request.remainingMs }; break;
        case "start": result = { tick, winner: null, packet, rejectedCommands: [] }; break;
        case "advance": {
          if (options.faultAtTick !== undefined && tick >= options.faultAtTick) throw new Error(MATCH_FAULT_CODE);
          tick += request.ticks;
          if (request.publish) { published.push(tick); publication?.({ tick, packet }); }
          result = { tick, winner: null, rejectedCommands: [], ...(request.commands.length ? { commandVisible: true } : {}) };
          break;
        }
        default: throw new Error("Unexpected operation");
      }
      return result as T;
    },
    async close() {},
  };
  const match = new LiveMatch(
    { id: "cadence", roomId: "room", createdAt: 0,
      settings: { ...defaultLobbySettings("africa"), aiCount: 0, tribeCount: 0 },
      members: ["a", "b"].map(guestId => ({ guestId, profile: { name: guestId, flagCode: null }, joinedAt: 0, connected: true })) },
    executor, "version", (_guest, message) => messages.push(message), () => {}, () => now,
  );
  await match.initialize();
  await match.qualify("a", "version");
  await match.qualify("b", "version");
  await match.advance();
  now = 10_000;
  await match.advance();
  requests.length = 0; published.length = 0; messages.length = 0;
  return { match, requests, published, messages, setTime: (value: number) => { now = value; }, now: () => now };
}

describe("publication gate with immediate order publication", () => {
  it("keeps background publications without orders within 5 per simulated second", async () => {
    const f = await fixture();
    expect(PUBLICATION_MIN_INTERVAL_MS).toBe(200);
    for (let step = 1; step <= 40; step++) {
      f.setTime(10_000 + step * TICK_MS);
      await f.match.advance();
    }
    expect(f.requests.filter(r => r.type === "advance")).toHaveLength(40);
    // 40 ticks = 5 simulated seconds.
    expect(f.published.length).toBeLessThanOrEqual(25);
    expect(f.published.length).toBeGreaterThanOrEqual(24);
    expect(f.messages.filter(m => m.type === "match-state").length).toBe(f.published.length * 2);
    // Each background publication takes its own 200 ms slot in simulation time;
    // slots are phase-locked to 125 ms ticks, so any k gaps span more than k
    // slots minus one tick.
    expect(PUBLICATION_MIN_INTERVAL_MS).toBeGreaterThan(TICK_MS);
    for (let i = 0; i < f.published.length; i++)
      for (let j = i + 1; j < f.published.length; j++)
        expect((f.published[j] - f.published[i]) * TICK_MS).toBeGreaterThan((j - i) * PUBLICATION_MIN_INTERVAL_MS - TICK_MS);
    await f.match.end("cadence tested");
  });

  it("publishes an order on the tick it takes effect, at most once per tick", async () => {
    const f = await fixture();
    for (let step = 1; step <= 40; step++) {
      f.match.command(step % 2 ? "a" : "b", `c${step}`, { type: "advance-age" });
      f.setTime(10_000 + step * TICK_MS);
      await f.match.advance();
    }
    // Every tick carried an order, so every tick published exactly once.
    expect(f.published).toEqual(Array.from({ length: 40 }, (_, i) => f.published[0] + i));
    expect(f.messages.filter(m => m.type === "match-state").length).toBe(80);
    expect(f.match.runtimeDiagnostics().commandPublication).toEqual({ count: 40, totalWaitTicks: 0, maxWaitTicks: 0 });
    await f.match.end("cadence tested");
  });

  it("publishes a committed command without waiting for the gate and restarts the background window", async () => {
    const f = await fixture();
    // Tick 1 is not a gate tick (the first gate opens after 200 ms), but the
    // order applied on it is published immediately.
    f.match.command("a", "move", { type: "advance-age" });
    f.setTime(10_000 + TICK_MS); await f.match.advance();
    expect(f.published).toEqual([1]);
    expect(f.match.runtimeDiagnostics().commandPublication).toEqual({ count: 1, totalWaitTicks: 0, maxWaitTicks: 0 });
    // The background window restarts from that publication: tick 2 (+125 ms)
    // stays quiet, tick 3 (+250 ms) publishes.
    f.setTime(10_000 + 2 * TICK_MS); await f.match.advance();
    expect(f.published).toEqual([1]);
    f.setTime(10_000 + 3 * TICK_MS); await f.match.advance();
    expect(f.published).toEqual([1, 3]);
    await f.match.end("cadence tested");
  });

  it("never publishes after the executor reports a fault", async () => {
    const f = await fixture({ faultAtTick: 3 });
    for (let step = 1; step <= 8; step++) {
      f.match.command("a", `f${step}`, { type: "advance-age" });
      f.setTime(10_000 + step * TICK_MS);
      await f.match.advance().catch(() => undefined);
    }
    expect(f.published.length).toBeGreaterThan(0);
    expect(f.published.every(tick => tick <= 3)).toBe(true);
    // A faulted advance carries no packet, so nothing past the fault reaches clients.
    expect(f.messages.filter(m => m.type === "match-state").length).toBe(f.published.length * 2);
  });
});
