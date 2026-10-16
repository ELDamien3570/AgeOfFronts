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

describe("N6 single publication gate (Design B)", () => {
  it("publishes at most 5 times per simulated second even with a command on every tick", async () => {
    const f = await fixture();
    expect(PUBLICATION_MIN_INTERVAL_MS).toBe(200);
    for (let step = 1; step <= 40; step++) {
      f.match.command(step % 2 ? "a" : "b", `c${step}`, { type: "advance-age" });
      f.setTime(10_000 + step * TICK_MS);
      await f.match.advance();
    }
    const advances = f.requests.filter(r => r.type === "advance");
    expect(advances).toHaveLength(40);
    // 40 ticks = 5 simulated seconds.
    expect(f.published.length).toBeLessThanOrEqual(25);
    expect(f.published.length).toBeGreaterThanOrEqual(24);
    const states = f.messages.filter(m => m.type === "match-state");
    expect(states.length).toBe(f.published.length * 2);
    // Each publication takes its own 200 ms gate slot in simulation time. The
    // slots are phase-locked to 125 ms ticks, so one gap may be a single tick,
    // but any k gaps span more than k slots minus one tick. Publishing on every
    // command (every tick) breaks this for k >= 2.
    expect(PUBLICATION_MIN_INTERVAL_MS).toBeGreaterThan(TICK_MS);
    for (let i = 0; i < f.published.length; i++)
      for (let j = i + 1; j < f.published.length; j++)
        expect((f.published[j] - f.published[i]) * TICK_MS).toBeGreaterThan((j - i) * PUBLICATION_MIN_INTERVAL_MS - TICK_MS);
    await f.match.end("cadence tested");
  });

  it("publishes a committed command at the first gate tick after its execution", async () => {
    const f = await fixture();
    // Tick 1 is not a gate tick (the first gate opens after 200 ms).
    f.match.command("a", "move", { type: "advance-age" });
    f.setTime(10_000 + TICK_MS); await f.match.advance();
    expect(f.published).toEqual([]);
    f.setTime(10_000 + 2 * TICK_MS); await f.match.advance();
    expect(f.published).toEqual([2]);
    const diagnostics = f.match.runtimeDiagnostics().commandPublication;
    expect(diagnostics).toEqual({ count: 1, totalWaitTicks: 1, maxWaitTicks: 1 });
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
