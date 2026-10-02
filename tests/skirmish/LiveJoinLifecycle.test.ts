import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { LiveMatch } from "../../src/skirmish/multiplayer/application/LiveMatch";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
  RuntimeSeat,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";
const packet = { hash: "0".repeat(64), payload: "test" };
async function fixture(start = true) {
  let now = 0,
    tick = 0,
    released = 0;
  const messages: { guest: string; message: ServerMessage }[] = [],
    requests: ExecutorRequest[] = [];
  const seats: RuntimeSeat[] = [1, 2, 3, 4, 5].map((playerId) => ({
    playerId,
    name: `Faction ${playerId}`,
    ai: playerId > 2,
    kind: playerId === 5 ? "tribe" : "regular",
    eliminated: false,
  }));
  const executor: MatchExecutor = {
    close: async () => {},
    request: async <T extends ExecutorResult>(r: ExecutorRequest) => {
      requests.push(r);
      let result: unknown;
      switch (r.type) {
        case "prepare":
          result = { mapHash: "test", options: r.options };
          break;
        case "start":
          result = { tick, winner: null, packet, seats, rejectedCommands: [] };
          break;
        case "advance":
          tick += r.ticks;
          result = {
            tick,
            winner: null,
            packet: r.publish ? packet : undefined,
            seats,
            rejectedCommands: [],
          };
          break;
        case "spawn-state":
          result = { remainingMs: r.remainingMs };
          break;
        case "join-barrier":
          seats.find((s) => s.playerId === r.playerId)!.ai = false;
          result = { tick, winner: null, packet, baseline: packet, seats };
          break;
        case "set-controller":
          seats.find((s) => s.playerId === r.playerId)!.ai = r.ai;
          result = { seats };
          break;
        default:
          throw new Error("Unexpected request");
      }
      return result as T;
    },
  };
  const match = new LiveMatch(
    {
      id: "test",
      roomId: "test",
      createdAt: 0,
      settings: {
        ...defaultLobbySettings("africa"),
        slots: 4,
        publicAiTakeover: true,
      },
      members: ["a", "b"].map((guestId) => ({
        guestId,
        profile: { name: guestId, flagCode: null },
        connected: true,
        joinedAt: 0,
      })),
    },
    executor,
    "build",
    (guest, message) => messages.push({ guest, message }),
    () => released++,
    () => now,
    undefined,
    undefined,
    { cooldownMs: 0 },
  );
  await match.initialize();
  await match.qualify("a", "build");
  await match.qualify("b", "build");
  await match.advance();
  if (start) {
    now = 10000;
    await match.advance();
  }
  requests.length = 0;
  messages.length = 0;
  const baseline = (guest: string) =>
    messages
      .filter((m) => m.guest === guest && m.message.type === "match-state")
      .slice(-1)[0]!.message as Extract<ServerMessage, { type: "match-state" }>;
  const watch = (guest: string, id: number) =>
    match.watch(guest, { name: guest, flagCode: null }, id);
  return {
    match,
    executor,
    seats,
    requests,
    messages,
    watch,
    baseline,
    time: (n: number) => {
      now = n;
    },
    released: () => released,
  };
}
describe("bounded live admission lifecycle", () => {
  it("uses a baseline barrier when returning readiness races the spawn-to-world transition", async () => {
    const f = await fixture(false);
    await f.match.disconnect("a");
    let finish!: (result: ExecutorResult) => void;
    const original = f.executor.request;
    f.executor.request = async <T extends ExecutorResult>(
      request: ExecutorRequest,
    ) =>
      request.type === "start"
        ? (new Promise<ExecutorResult>((resolve) => {
            finish = resolve;
          }) as Promise<T>)
        : original<T>(request);
    f.time(10_000);
    const starting = f.match.advance();
    f.match.watch("a", { name: "A", flagCode: null });
    const qualifying = f.match.qualify("a", "build");
    finish({
      tick: 0,
      winner: null,
      packet,
      rejectedCommands: [],
      seats: f.seats,
    });
    await starting;
    await qualifying;
    expect(f.requests.some((request) => request.type === "spawn-state")).toBe(
      false,
    );
    expect(f.baseline("a").syncId).toBeTruthy();
    const baseline = f.baseline("a");
    f.match.acknowledge("a", baseline.syncId!, baseline.publicationSequence!);
    await f.match.end("test");
  });

  it("lets remembered owners return during spawn selection after all players disconnect", async () => {
    const f = await fixture(false);
    await f.match.disconnect("a");
    await f.match.disconnect("b");
    f.time(60_000);
    expect(f.match.summary("a")?.rejoinPlayerId).toBe(1);
    expect(f.match.summary("stranger")).toBeUndefined();
    f.match.watch("a", { name: "A", flagCode: null });
    await f.match.advance();
    expect(f.requests.some((request) => request.type === "start")).toBe(false);
    f.time(70_000);
    await f.match.qualify("a", "build");
    expect(f.match.connected("a")).toBe(true);
    expect(f.match.isAdmitting("a")).toBe(false);
    f.time(80_001);
    await f.match.advance();
    expect(f.baseline("a").tick).toBe(0);
    expect(f.requests.some((request) => request.type === "join-barrier")).toBe(
      false,
    );
    await f.match.end("test");
  });

  it("loads after 60s match age without pausing, then resumes without catchup only after exact applied ACK", async () => {
    const f = await fixture();
    f.time(120000);
    await f.match.advance();
    f.watch("new", 3);
    f.time(160000);
    await f.match.advance();
    expect(f.match.summary("new")?.status).toBe("running");
    expect(f.requests.slice(-1)[0]?.type).toBe("advance");
    await f.match.qualify("new", "build");
    const b = f.baseline("new");
    expect(() =>
      f.match.acknowledge("new", b.syncId!, b.publicationSequence! + 1),
    ).toThrow(/expired/);
    expect(() =>
      f.match.acknowledge("wrong", b.syncId!, b.publicationSequence!),
    ).toThrow(/expired/);
    f.match.acknowledge("new", b.syncId!, b.publicationSequence!);
    expect(f.match.playerId("new")).toBe(3);
    f.time(160050);
    await f.match.advance();
    expect(f.requests.slice(-1)[0]).toMatchObject({
      type: "advance",
      ticks: 1,
    });
    await f.match.end("test");
  });
  it("rolls failed sync back to AI, rejects stale ACKs, releases pending claims and always resumes", async () => {
    const f = await fixture();
    f.watch("slow", 3);
    await f.match.qualify("slow", "build");
    const b = f.baseline("slow");
    f.time(15001);
    await f.match.advance();
    expect(f.seats[2].ai).toBe(true);
    expect(f.match.playerId("slow")).toBe(0);
    expect(
      f.match.summary("other")?.freeAiSeats.map((s) => s.playerId),
    ).toContain(3);
    expect(() =>
      f.match.acknowledge("slow", b.syncId!, b.publicationSequence!),
    ).toThrow(/expired/);
    expect(f.match.summary("other")?.status).toBe("running");
    f.time(15051);
    await f.match.advance();
    expect(f.requests.slice(-1)[0]).toMatchObject({
      type: "advance",
      ticks: 1,
    });
    await f.match.end("test");
  });
  it("cancels a disconnected join, revalidates eliminated factions, and rejects a version mismatch without pause", async () => {
    const f = await fixture();
    f.watch("new", 3);
    await expect(f.match.qualify("new", "wrong")).rejects.toThrow(/versions/);
    expect(f.match.summary("new")?.status).toBe("running");
    f.seats[2].eliminated = true;
    await expect(f.match.qualify("new", "build")).rejects.toThrow(
      /no longer available/,
    );
    f.seats[2].eliminated = false;
    await f.match.qualify("new", "build");
    await f.match.disconnect("new");
    expect(f.seats[2].ai).toBe(true);
    expect(f.match.isAdmitting("new")).toBe(false);
    expect(f.match.summary("new")?.status).toBe("running");
    expect(() => f.watch("tribe", 5)).toThrow(/no longer available/);
    await f.match.end("test");
  });
  it("finishes an in-flight advance before capturing S and excludes another admission", async () => {
    const f = await fixture();
    let finish!: (r: ExecutorResult) => void;
    const original = f.executor.request;
    f.executor.request = async <T extends ExecutorResult>(
      r: ExecutorRequest,
    ) =>
      r.type === "advance"
        ? (new Promise<ExecutorResult>((resolve) => {
            finish = resolve;
          }) as Promise<T>)
        : original<T>(r);
    f.time(10200);
    const advancing = f.match.advance();
    f.watch("first", 3);
    f.watch("second", 4);
    const qualify = f.match.qualify("first", "build");
    await expect(f.match.qualify("second", "build")).rejects.toThrow(
      /synchronizing/,
    );
    expect(f.requests.some((r) => r.type === "join-barrier")).toBe(false);
    f.time(17_000); // Worker wait exceeds the former five-second application limit.
    finish({
      tick: 4,
      winner: null,
      packet,
      rejectedCommands: [],
      seats: f.seats,
    });
    await advancing;
    await qualify;
    expect(f.requests.some((r) => r.type === "join-barrier")).toBe(true);
    const baseline=f.baseline("first");f.time(21_000);
    f.match.acknowledge("first",baseline.syncId!,baseline.publicationSequence!);
    expect(f.match.connected("first")).toBe(true);
    expect(f.released()).toBe(0);
    await f.match.disconnect("first");
    await f.match.end("test");
  });
  it("rebases a slow flow-controlled client without changing other clients' delta cursor or pausing the match",async()=>{
    const f=await fixture();const original=f.executor.request;
    f.executor.request=async<T extends ExecutorResult>(request:ExecutorRequest)=>request.type==="client-baseline"
      ? ({tick:4,winner:null,baseline:packet} as T) : original<T>(request);
    f.watch("slow",3);await f.match.qualify("slow","build",true);
    const baseline=f.baseline("slow");f.match.stateApplied("slow",baseline.publicationSequence!,baseline.flowEpoch!);
    f.match.acknowledge("slow",baseline.syncId!,baseline.publicationSequence!);
    for(const time of [10_200,10_400,10_600,10_800]){f.time(time);await f.match.advance();}
    const sent=f.baseline("slow");
    f.time(11_000);await f.match.advance();expect(f.baseline("slow").publicationSequence).toBe(sent.publicationSequence);
    f.match.stateApplied("slow",sent.publicationSequence!,sent.flowEpoch!);
    await Promise.resolve();await Promise.resolve();
    const rebased=f.baseline("slow");expect(rebased.rebase).toBe(true);expect(rebased.flowEpoch).toBeGreaterThan(sent.flowEpoch!);
    expect(f.match.summary("a")?.status).toBe("running");expect(f.released()).toBe(0);
    f.match.stateApplied("slow",sent.publicationSequence!,sent.flowEpoch!); // Stale ACK does not grant credit.
    expect(f.baseline("slow").publicationSequence).toBe(rebased.publicationSequence);
    await f.match.end("test");
  });
  it("retains ownership and capacity through grace; successful rejoin clears it, failed joins never extend it", async () => {
    const f = await fixture();
    await f.match.disconnect("a");
    await f.match.disconnect("b");
    expect(f.match.summary("a")?.rejoinPlayerId).toBe(1);
    f.time(60000);
    f.match.watch("a", { name: "renamed", flagCode: null });
    await f.match.qualify("a", "build");
    const b = f.baseline("a");
    f.match.acknowledge("a", b.syncId!, b.publicationSequence!);
    expect(f.match.summary("a")?.status).toBe("running");
    await f.match.disconnect("a");
    f.time(179999);
    await f.match.advance();
    expect(f.released()).toBe(0);
    f.time(180001);
    await f.match.advance();
    await f.match.end("again");
    expect(f.released()).toBe(1);
  });
  it("allows newcomers to take over AI empires beyond the initial slots limit while strictly locking existing players to their empires", async () => {
    // Create a match where slots is 2, and both human slots are occupied by 'a' and 'b'.
    let now = 0, tick = 0, released = 0;
    const messages: { guest: string; message: ServerMessage }[] = [];
    const seats: RuntimeSeat[] = [1, 2, 3, 4, 5].map((playerId) => ({
      playerId,
      name: `Faction ${playerId}`,
      ai: playerId > 2,
      kind: playerId === 5 ? "tribe" : "regular",
      eliminated: false,
    }));
    const executor: MatchExecutor = {
      close: async () => {},
      request: async <T extends ExecutorResult>(r: ExecutorRequest) => {
        let result: unknown;
        if (r.type === "prepare") result = { mapHash: "test", options: r.options };
        else if (r.type === "start") result = { tick, winner: null, packet, seats, rejectedCommands: [] };
        else if (r.type === "advance") {
          tick += r.ticks;
          result = { tick, winner: null, packet: r.publish ? packet : undefined, seats, rejectedCommands: [] };
        } else if (r.type === "join-barrier") {
          seats.find((s) => s.playerId === r.playerId)!.ai = false;
          result = { tick, winner: null, packet, baseline: packet, seats };
        } else if (r.type === "spawn-state") result = { remainingMs: r.remainingMs };
        else if (r.type === "set-controller") {
          seats.find((s) => s.playerId === r.playerId)!.ai = r.ai;
          result = { seats };
        } else {
          throw new Error("Unexpected request: " + (r as { type: string }).type);
        }
        return result as T;
      },
    };
    const match = new LiveMatch(
      {
        id: "full-slots-match",
        roomId: "full-slots-room",
        createdAt: 0,
        settings: {
          ...defaultLobbySettings("africa"),
          slots: 2, // Only 2 initial human slots!
          aiCount: 2,
          tribeCount: 1,
          publicAiTakeover: true,
        },
        members: ["a", "b"].map((guestId) => ({
          guestId,
          profile: { name: guestId, flagCode: null },
          connected: true,
          joinedAt: 0,
        })),
      },
      executor,
      "build",
      (guest, message) => messages.push({ guest, message }),
      () => released++,
      () => now,
      undefined,
      undefined,
      { cooldownMs: 0 },
    );
    await match.initialize();
    await match.qualify("a", "build");
    await match.qualify("b", "build");
    await match.advance();
    now = 10000;
    await match.advance();

    // 1. Initial human seats (2) are fully claimed.
    const newcomerSummary = match.summary("newcomer");
    expect(newcomerSummary?.freeAiSeats.map((s) => s.playerId)).toEqual([3, 4]);

    // 2. Existing player 'a' (who owns player 1) cannot take over AI faction 3.
    expect(() =>
      match.watch("a", { name: "a", flagCode: null }, 3),
    ).toThrow(/already own a faction/);

    // 3. Existing player 'a' summary does NOT offer freeAiSeats, only rejoin/reserved.
    const ownerSummary = match.summary("a");
    expect(ownerSummary?.freeAiSeats).toEqual([]);

    // 4. Newcomer 'newcomer-c' successfully takes over AI faction 3 even though seats (2) >= slots (2).
    match.watch("newcomer-c", { name: "Charlie", flagCode: null }, 3);
    await match.qualify("newcomer-c", "build");
    const baselineC = messages
      .filter((m) => m.guest === "newcomer-c" && m.message.type === "match-state")
      .slice(-1)[0]!.message as Extract<ServerMessage, { type: "match-state" }>;
    match.acknowledge("newcomer-c", baselineC.syncId!, baselineC.publicationSequence!);
    expect(match.playerId("newcomer-c")).toBe(3);

    // 5. 'newcomer-c' is now permanently bound to faction 3 and cannot switch to faction 4.
    expect(() =>
      match.watch("newcomer-c", { name: "Charlie", flagCode: null }, 4),
    ).toThrow(/already own a faction/);

    // 6. Summary for another newcomer 'newcomer-d' shows only remaining AI faction 4.
    const dSummary = match.summary("newcomer-d");
    expect(dSummary?.freeAiSeats.map((s) => s.playerId)).toEqual([4]);

    // 7. 'newcomer-d' takes over faction 4.
    match.watch("newcomer-d", { name: "Dave", flagCode: null }, 4);
    await match.qualify("newcomer-d", "build");
    const baselineD = messages
      .filter((m) => m.guest === "newcomer-d" && m.message.type === "match-state")
      .slice(-1)[0]!.message as Extract<ServerMessage, { type: "match-state" }>;
    match.acknowledge("newcomer-d", baselineD.syncId!, baselineD.publicationSequence!);
    expect(match.playerId("newcomer-d")).toBe(4);

    // 8. Now all AI empires are taken; summary for 'newcomer-e' has empty freeAiSeats.
    const eSummary = match.summary("newcomer-e");
    expect(eSummary?.freeAiSeats).toEqual([]);

    // 9. Any further attempt to watch an empire fails.
    expect(() =>
      match.watch("newcomer-e", { name: "Eve", flagCode: null }, 3),
    ).toThrow(/reserved for its original player/);
    expect(() =>
      match.watch("newcomer-e", { name: "Eve", flagCode: null }, 5),
    ).toThrow(/no longer available/);

    await match.end("done");
  });
});
