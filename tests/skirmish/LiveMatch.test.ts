import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import {
  LiveMatch,
  MAX_QUEUED_COMMANDS,
  MAX_RECENT_COMMANDS,
} from "../../src/skirmish/multiplayer/application/LiveMatch";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchAdvance,
  MatchExecutor,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";

const packet = { hash: "0".repeat(64), payload: "test" };
async function fixture(stream = false) {
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
        profile: { name: guestId, flagCode: null },
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
  it("observes scheduler debt, admission and active progress without publishing diagnostics", async () => {
    const f = await fixture();
    f.setTime(10_500);
    await f.match.advance();
    const observed = f.match.runtimeDiagnostics();
    expect(observed).toMatchObject({ matchId: "test", runtimeId: "version", tick: 4,
      progress: { simulatedMs: 200, wallMs: 500, ratio: 0.4 } });
    expect(observed.timings.scheduler?.maximum).toBe(450);
    expect(() => f.match.command("a", "bad", { type: "invalid" })).toThrow();
    f.match.command("a", "accepted", { type: "advance-age" });
    expect(f.match.runtimeDiagnostics().timings.validation?.samples).toBeGreaterThanOrEqual(3);
    expect(f.match.runtimeDiagnostics().timings.admission?.samples).toBe(1);
    expect(f.messages.some(({ message }) => "diagnostics" in message)).toBe(false);
    expect(f.requests.find(request => request.type === "advance")).toMatchObject({ ticks: 4 });
    await f.match.end("test complete");
  });
  it("labels delayed publication with its capture tick without rewinding simulation progress", async () => {
    const f = await fixture(true);
    f.setTime(10_200); await f.match.advance();
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
    f.setTime(10_050);await f.match.advance();
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

  it("ticks at20Hz, publishes at5Hz and bounds catch-up without overlapping advances", async () => {
    const f = await fixture();
    f.setTime(10_050);
    await f.match.advance();
    expect(f.requests[0]).toMatchObject({
      type: "advance",
      ticks: 1,
      publish: false,
    });
    expect(f.messages).toHaveLength(0);
    f.setTime(10_200);
    await f.match.advance();
    expect(f.requests[1]).toMatchObject({
      type: "advance",
      ticks: 3,
      publish: true,
    });
    expect(f.messages).toHaveLength(2);
    await f.match.advance();
    expect(f.requests).toHaveLength(2);
    f.setTime(12_000);
    await f.match.advance();
    expect(f.requests[2]).toMatchObject({
      type: "advance",
      ticks: 4,
      publish: true,
    });
    await f.match.advance();
    expect(f.requests).toHaveLength(3);
    f.setTime(12_050);
    await f.match.advance();
    expect(f.requests[3]).toMatchObject({
      type: "advance",
      ticks: 1,
      publish: false,
    });

    let complete!: (result: MatchAdvance) => void;
    f.executor.request = async <T extends ExecutorResult>(
      request: ExecutorRequest,
    ) => {
      f.requests.push(request);
      return (await new Promise<MatchAdvance>((resolve) => {
        complete = resolve;
      })) as T;
    };
    f.setTime(12_100);
    const pending = f.match.advance();
    f.setTime(12_600);
    await f.match.advance();
    expect(f.requests).toHaveLength(5);
    complete({ tick: 10, winner: null, rejectedCommands: [] });
    await pending;
  });

  it("overwrites claimed ownership, deduplicates commands and bounds queue/history", async () => {
    const f = await fixture();
    f.match.command("b", "same", { type: "advance-age", playerId: 1 });
    f.match.command("b", "same", { type: "advance-age", playerId: 1 });
    f.setTime(10_050);
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
    let now = 10_100;
    f.setTime(now);
    await f.match.advance();
    for (let i = 0; i < MAX_RECENT_COMMANDS + 100; i++) {
      f.match.command("a", `history-${i}`, { type: "advance-age" });
      if ((i + 1) % MAX_QUEUED_COMMANDS === 0) {
        f.setTime((now += 50));
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
    f.setTime(10_200);
    await f.match.advance();
    expect(f.requests[0]).toMatchObject({
      type: "advance",
      disconnectedPlayerIds: [1],
      commands: [],
      publish: true,
    });
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0].guest).toBe("b");
    expect(f.messages[0].message).toMatchObject({
      type: "match-state",
      paused: false,
      tick: 4,
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
    f.setTime(10_050);
    await f.match.advance();
    expect(f.messages).toEqual([
      { guest: "b", message: { type: "error", message: "Not enough gold" } },
    ]);
  });

  it("publishes the final state before ending and closing the worker", async () => {
    const f = await fixture();
    f.executor.request = async <T extends ExecutorResult>() =>
      ({ tick: 1, winner: 1, packet, rejectedCommands: [] }) as unknown as T;
    f.setTime(10_050);
    await f.match.advance();
    expect(f.messages.map((item) => item.message.type)).toEqual([
      "match-state",
      "match-state",
      "match-ended",
      "match-ended",
    ]);
    expect(f.cleanup()).toEqual({ released: 1, closed: 1 });
  });
});
