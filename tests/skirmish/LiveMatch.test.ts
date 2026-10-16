import {secondsToTicks} from '../../src/skirmish/Protocol';
import { describe, expect, it, vi } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import {
  LiveMatch,
  MAX_QUEUED_COMMANDS,
  MAX_RECENT_COMMANDS,
} from "../../src/skirmish/multiplayer/application/LiveMatch";
import {
  MATCH_FAULT_CODE,
  MATCH_FAULT_MESSAGE,
  type ExecutorRequest,
  type ExecutorResult,
  type MatchAdvance,
  type MatchExecutor,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";

const packet = { hash: "0".repeat(64), payload: "test" };
async function fixture(stream = false, colorIndex?: number) {
  let now = 0,
    tick = 0,
    released = 0,
    closed = 0;
  const requests: ExecutorRequest[] = [];
  const messages: { guest: string; message: ServerMessage }[] = [];
  let publication: ((value: { tick: number; packet: typeof packet }) => void) | undefined;
  const executor: MatchExecutor = {
    ...(stream ? { onPublication: (listener: NonNullable<typeof publication>) => { publication = listener; return () => { publication = undefined; }; } } : {}),
    async request<T extends ExecutorResult>(
      request: ExecutorRequest,
    ): Promise<T> {
      requests.push(request);
      let result: unknown;
      switch (request.type) {
        case "prepare":
          result = { mapHash: "map", options: request.options };
          break;
        case "spawn-state":
          result = { remainingMs: request.remainingMs };
          break;
        case "start":
          result = { tick, winner: null, packet, rejectedCommands: [] };
          break;
        case "advance":
          tick += request.ticks;
          result = {
            tick,
            winner: null,
            packet: !stream && request.publish ? packet : undefined,
            rejectedCommands: [],
          };
          break;
        case "baseline":
          result = packet;
          break;
        default:
          throw new Error("Unexpected operation");
      }
      return result as T;
    },
    async close() {
      closed++;
    },
  };
  const match = new LiveMatch(
    {
      id: "test",
      roomId: "room",
      createdAt: 0,
      settings: {
        ...defaultLobbySettings("africa"),
        aiCount: 0,
        tribeCount: 0,
      },
      members: ["a", "b"].map((guestId) => ({
        guestId,
        profile: { name: guestId, flagCode: null, ...(guestId === "a" && colorIndex !== undefined ? { colorIndex } : {}) },
        joinedAt: 0,
        connected: true,
      })),
    },
    executor,
    "version",
    (guest, message) => messages.push({ guest, message }),
    () => released++,
    () => now,
  );
  await match.initialize();
  await match.qualify("a", "version");
  await match.qualify("b", "version");
  await match.advance();
  expect(() => match.command("a", "early", { type: "advance-age" })).toThrow(
    /spawn/,
  );
  now = 10_000;
  await match.advance();
  const initial = messages.filter(
    (item) => item.message.type === "match-state",
  );
  expect(initial).toHaveLength(2);
  expect(
    initial.every(
      (item) =>
        item.message.type === "match-state" &&
        item.message.tick === 0 &&
        item.message.executor === "server",
    ),
  ).toBe(true);
  requests.length = messages.length = 0;
  return {
    publish: (tick: number) => publication?.({ tick, packet }),
    match,
    executor,
    requests,
    messages,
    setTime: (value: number) => {
      now = value;
    },
    cleanup: () => ({ released, closed }),
  };
}

describe("server-authoritative live match", () => {
  it("advances on its own timer at each tick deadline, without the coordinator poll", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      // The started match armed its own timer for the first tick deadline.
      f.setTime(10_125);
      await vi.advanceTimersByTimeAsync(125);
      expect(f.requests.filter(r => r.type === "advance")).toHaveLength(1);
      f.setTime(10_250);
      await vi.advanceTimersByTimeAsync(125);
      expect(f.requests.filter(r => r.type === "advance")).toHaveLength(2);
      // Exactly one tick per deadline: no aliased two-tick catch-up batches.
      expect(f.requests.filter(r => r.type === "advance").every(r => r.type === "advance" && r.ticks === 1)).toBe(true);
      await f.match.end("done");
      f.setTime(10_375);
      await vi.advanceTimersByTimeAsync(100);
      expect(f.requests.filter(r => r.type === "advance")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("passes lobby color reservations to the authoritative match setup", async () => {
    const f = await fixture(false, 7);
    expect(f.match.options.humanColors).toEqual([7, null]);
    await f.match.end("color setup tested");
  });

  it("observes scheduler debt, admission and active progress without publishing diagnostics", async () => {
    const f = await fixture();
    f.setTime(10_500);
    await f.match.advance();
    const observed = f.match.runtimeDiagnostics();
    expect(observed).toMatchObject({ matchId: "test", runtimeId: "version", tick: 1,
      progress: { simulatedMs: 125, wallMs: 500, ratio: 0.25 } });
    expect(observed.timings.scheduler?.maximum).toBe(375);
    expect(() => f.match.command("a", "bad", { type: "invalid" })).toThrow();
    f.match.command("a", "accepted", { type: "advance-age" });
    expect(f.match.runtimeDiagnostics().timings.validation?.samples).toBeGreaterThanOrEqual(3);
    expect(f.match.runtimeDiagnostics().timings.admission?.samples).toBe(1);
    expect(f.messages.some(({ message }) => "diagnostics" in message)).toBe(false);
    expect(f.requests.find(request => request.type === "advance")).toMatchObject({ ticks: 1 });
    await f.match.end("test complete");
  });
  it("labels delayed publication with its capture tick without rewinding simulation progress", async () => {
    const f = await fixture(true);
    f.setTime(10_500); await f.match.advance();
    await f.match.advance(); await f.match.advance(); await f.match.advance();
    expect(f.match.progress().tick).toBe(4);
    f.publish(1);
    const states = f.messages.filter(m => m.message.type === "match-state");
    expect(states).toHaveLength(2);
    expect(states.every(m => m.message.type === "match-state" && m.message.tick === 1)).toBe(true);
    expect(f.match.progress().tick).toBe(4);
  });
  it("reports lack of match progress separately from a live coordinator", async () => {
    const f = await fixture();
    expect(f.match.progress()).toMatchObject({ state: "running", tick: 0, ageMs: 0 });
    f.setTime(16_000);
    expect(f.match.progress()).toMatchObject({ state: "stalled", tick: 0, ageMs: 6000 });
    await f.match.advance();
    expect(f.match.progress().state).toBe("running");
    expect(f.match.progress().tick).toBeGreaterThan(0);
  });
  it("relays correlated outcomes only to their original guest and strips the authenticated identity prefix", async () => {
    const f = await fixture();
    f.executor.request = async <T extends ExecutorResult>(request: ExecutorRequest) => {
      expect(request.type).toBe("advance");
      return {tick:1,winner:null,rejectedCommands:[{id:"a-bad",playerId:1,message:"Rejected"}],commandOutcomes:[
        {id:"a-move",playerId:1,tick:1,status:"deferred"},
        {id:"a-bad",playerId:1,tick:1,status:"rejected",reason:"Rejected"},
        {id:"predecessor-move",playerId:1,tick:1,status:"superseded"},
        {id:"b-move",playerId:2,tick:1,status:"executed"},
      ]} as T;
    };
    f.setTime(10_125);await f.match.advance();
    expect(f.messages).toEqual([
      {guest:"a",message:{type:"match-command-outcome",matchId:"test",outcome:{id:"move",playerId:1,tick:1,status:"deferred"}}},
      {guest:"a",message:{type:"match-command-outcome",matchId:"test",outcome:{id:"bad",playerId:1,tick:1,status:"rejected",reason:"Rejected"}}},
      {guest:"b",message:{type:"match-command-outcome",matchId:"test",outcome:{id:"move",playerId:2,tick:1,status:"executed"}}},
    ]);
  });
  it("waits for prepared map identity before announcing, including a departure during loading", async () => {
    let finish!: (result: ExecutorResult) => void;
    const messages: { guest: string; message: ServerMessage }[] = [];
    const match = new LiveMatch(
      {
        id: "loading",
        roomId: "room",
        createdAt: 0,
        settings: defaultLobbySettings("africa"),
        members: ["a", "b"].map((guestId) => ({
          guestId,
          profile: { name: guestId, flagCode: null },
          joinedAt: 0,
          connected: true,
        })),
      },
      {
        request: <T extends ExecutorResult>() =>
          new Promise<ExecutorResult>((resolve) => {
            finish = resolve;
          }) as Promise<T>,
        close: async () => {},
      },
      "version",
      (guest, message) => messages.push({ guest, message }),
      () => {},
      () => 0,
    );
    const preparing = match.initialize();
    match.announce("b");
    expect(messages).toEqual([]);
    await match.disconnect("a");
    finish({ mapHash: "prepared-map", options: match.options });
    await preparing;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      guest: "b",
      message: { type: "match", manifest: { mapHash: "prepared-map" } },
    });
  });

  it("ticks at 8 Hz, retains the independent publication cadence, and bounds catch-up",async()=>{
    const f=await fixture();f.setTime(10_125);await f.match.advance();
    expect(f.requests[0]).toMatchObject({type:"advance",ticks:1,publish:false});
    f.setTime(10_250);await f.match.advance();
    expect(f.requests[1]).toMatchObject({type:"advance",ticks:1,publish:true});
    expect(f.messages).toHaveLength(2);
    f.match.command("a","between-ticks",{type:"advance-age"});f.setTime(10_375);await f.match.advance();
    expect(f.requests[2]).toMatchObject({commands:[{id:"between-ticks",command:{type:"advance-age",playerId:1}}]});
    const before=f.requests.length;f.setTime(12_000);for(let i=0;i<8;i++)await f.match.advance();
    const advances=f.requests.slice(before).filter(r=>r.type==="advance");expect(advances.length).toBeGreaterThan(0);expect(advances.length).toBeLessThanOrEqual(4);
    expect(advances.every(r=>r.type==="advance"&&r.ticks===1)).toBe(true);await f.match.end("test");
  });

  it("overwrites claimed ownership, deduplicates commands and bounds queue/history", async () => {
    const f = await fixture();
    f.match.command("b", "same", { type: "advance-age", playerId: 1 });
    f.match.command("b", "same", { type: "advance-age", playerId: 1 });
    f.setTime(10_125);
    await f.match.advance();
    expect(f.requests[0]).toMatchObject({
      type: "advance",
      commands: [{ id: "same", command: { type: "advance-age", playerId: 2 } }],
    });
    for (let i = 0; i < MAX_QUEUED_COMMANDS; i++)
      f.match.command("a", `queued-${i}`, { type: "advance-age" });
    expect(() =>
      f.match.command("a", "overflow", { type: "advance-age" }),
    ).toThrow(/queue is full/);
    let now = 10_250;
    f.setTime(now);
    await f.match.advance();
    for (let i = 0; i < MAX_RECENT_COMMANDS + 100; i++) {
      f.match.command("a", `history-${i}`, { type: "advance-age" });
      if ((i + 1) % MAX_QUEUED_COMMANDS === 0) {
        f.setTime((now += 125));
        await f.match.advance();
      }
    }
    expect((f.match as unknown as { seen: Set<string> }).seen.size).toBe(
      MAX_RECENT_COMMANDS,
    );
    expect(
      (f.match as unknown as { commands: unknown[] }).commands.length,
    ).toBeLessThanOrEqual(MAX_QUEUED_COMMANDS);
  });

  it("keeps the remaining player running and pauses during grace and releases once after everyone leaves", async () => {
    const f = await fixture();
    f.match.command("a", "departing", { type: "advance-age" });
    await f.match.disconnect("a");
    expect(() => f.match.announce("a")).toThrow(/reconnect/);
    expect(() => f.match.command("a", "late", { type: "advance-age" })).toThrow(
      /not active/,
    );
    f.setTime(10_500);
    await f.match.advance();
    expect(f.requests[0]).toMatchObject({
      type: "advance",
      disconnectedPlayerIds: [1],
      commands: [],
      publish: false,
    });
    await f.match.advance(); await f.match.advance(); await f.match.advance();
    expect(f.requests.some(r=>r.type==="advance"&&r.publish)).toBe(true);
    expect(f.messages.length).toBeGreaterThanOrEqual(1);
    expect(f.messages[0].guest).toBe("b");
    expect(f.messages[f.messages.length-1].message).toMatchObject({
      type: "match-state",
      paused: false,
      tick: 2,
    });
    await f.match.disconnect("b");
    await f.match.disconnect("b");
    await f.match.advance();
    expect(f.cleanup()).toEqual({ released: 0, closed: 0 });
    f.setTime(130_201);
    await f.match.advance();
    await f.match.end("repeat");
    expect(f.cleanup()).toEqual({ released: 1, closed: 1 });
  });

  it("reports domain rejections only to their sender and ignores repeated ready messages", async () => {
    const f = await fixture();
    await f.match.qualify("a", "version");
    expect(f.requests).toHaveLength(0);
    f.executor.request = async <T extends ExecutorResult>() =>
      ({
        tick: 1,
        winner: null,
        rejectedCommands: [
          { id: "bad", playerId: 2, message: "Not enough gold" },
        ],
      }) as T;
    f.setTime(10_125);
    await f.match.advance();
    expect(f.messages).toEqual([
      { guest: "b", message: { type: "error", message: "Not enough gold" } },
    ]);
  });

  it.each([1, -1])("publishes the final winner %s state before ending and closing the worker", async (winner) => {
    const f = await fixture();
    f.executor.request = async <T extends ExecutorResult>() =>
      ({ tick: 1, winner, packet, rejectedCommands: [] }) as unknown as T;
    f.setTime(10_125);
    await f.match.advance();
    expect(f.messages.map((item) => item.message.type)).toEqual([
      "match-state",
      "match-state",
      "match-ended",
      "match-ended",
    ]);
    expect(f.messages.filter(item => item.message.type === "match-ended").every(item => item.message.type === "match-ended" && item.message.completed)).toBe(true);
    expect(f.cleanup()).toEqual({ released: 1, closed: 1 });
  });

  it("ends a faulted simulation with the fixed message and stops advancing", async () => {
    const f = await fixture();
    let advances = 0;
    f.executor.request = async <T extends ExecutorResult>(request: ExecutorRequest): Promise<T> => {
      if (request.type === "advance") advances++;
      throw new Error(MATCH_FAULT_CODE);
    };
    f.setTime(10_125);
    await f.match.advance().catch((error) => f.match.endAfterFailure(error));
    await vi.waitFor(() => expect(f.messages.filter(item => item.message.type === "match-ended")).toHaveLength(2));
    const ended = f.messages.filter(item => item.message.type === "match-ended").map(item => item.message);
    expect(ended).toEqual([0, 1].map(() => ({ type: "match-ended", completed: false, matchId: "test",
      message: MATCH_FAULT_MESSAGE, reason: MATCH_FAULT_CODE })));
    const count = advances;
    f.setTime(20_000);
    await f.match.advance().catch(() => undefined);
    expect(advances).toBe(count);
    expect(f.cleanup()).toEqual({ released: 1, closed: 1 });
  });
});
