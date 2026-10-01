import { describe, expect, it } from "vitest";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { HostedRuntime } from "../../src/skirmish/multiplayer/application/HostedRuntime";
import { LiveMatch } from "../../src/skirmish/multiplayer/application/LiveMatch";
import type {
  ExecutorRequest,
  ExecutorResult,
  MatchExecutor,
} from "../../src/skirmish/multiplayer/application/MatchExecutor";
import { ReservedMatchWorker } from "../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import type { ServerMessage } from "../../src/skirmish/multiplayer/Protocol";
import { decodeState } from "../../src/skirmish/multiplayer/StateCodec";
import type { Skirmish } from "../../src/skirmish/Simulation";

describe("live client-hosted match", () => {
  it("shares committed states, fences a lost host, migrates, falls back, and releases when abandoned", async () => {
    const map = {
      width: 160,
      height: 100,
      terrain: new Uint8Array(16000).fill(133),
    };
    const worker = new ReservedMatchWorker();
    const executor: MatchExecutor = {
      request: <T extends ExecutorResult>(request: ExecutorRequest) =>
        worker.request<T>(
          request.type === "initialize" || request.type === "prepare" ? { ...request, map } : request,
        ),
      close: () => worker.close(),
    };
    let now = 0,
      released = 0;
    const messages: { guest: string; message: ServerMessage }[] = [];
    const match = new LiveMatch(
      {
        id: "test",
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
      executor,
      "version",
      (guest, message) => messages.push({ guest, message }),
      () => released++,
      () => now,
    );
    const next = <T extends ServerMessage["type"]>(
      guest: string,
      type: T,
    ): Extract<ServerMessage, { type: T }> => {
      const index = messages.findIndex(
        (item) => item.guest === guest && item.message.type === type,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return messages.splice(index, 1)[0].message as Extract<
        ServerMessage,
        { type: T }
      >;
    };
    try {
      await match.initialize();
      const manifest = next("a", "match").manifest;
      expect(next("b", "match").manifest.playerId).toBe(2);
      const host = new HostedRuntime(map, manifest.options);
      await match.qualify("a", "version", 1);
      await match.qualify("b", "version", 2);
      messages.length = 0;
      await match.advance();
      expect(next("a", "match-spawn").state.remainingMs).toBe(20_000);
      await match.selectSpawn("a", 25 * map.width + 25);
      await match.selectSpawn("b", 70 * map.width + 125);
      expect(() => match.command("a", "early", { type: "advance-age" })).toThrow(/spawn/);
      now += 19_999;
      await match.advance();
      expect(messages.some(item => item.message.type === "host-restore")).toBe(false);
      now++;
      await match.advance();
      const restore = next("a", "host-restore");
      host.restore(
        await decodeState<ReturnType<Skirmish["checkpoint"]>>(
          restore.checkpoint,
        ),
        restore.stateId,
      );
      expect(host.match.players[0].base).toBe(25 * map.width + 25);
      expect(host.match.players[1].base).toBe(70 * map.width + 125);
      await expect(match.selectSpawn("a", 30 * map.width + 30)).rejects.toThrow(/not open/);
      match.hostReady("a", restore.epoch, 0, restore.stateId);
      messages.length = 0;
      await match.advance();
      const batch = next("a", "host-batch");
      await match.accept("a", batch.epoch, await host.run(batch.batch));
      expect(next("a", "match-state").packet).toEqual(
        next("b", "match-state").packet,
      );
      await match.disconnect("a");
      now += 200;
      await match.advance();
      const replacement = next("b", "host-restore");
      expect(replacement.epoch).toBeGreaterThan(restore.epoch);
      await expect(
        match.accept(
          "a",
          restore.epoch,
          await host.run({
            previousTick: 4,
            commands: [],
            disconnectedPlayerIds: [],
          }),
        ),
      ).rejects.toThrow();
      host.restore(
        await decodeState<ReturnType<Skirmish["checkpoint"]>>(
          replacement.checkpoint,
        ),
        replacement.stateId,
      );
      match.hostReady("b", replacement.epoch, 4, replacement.stateId);
      await match.advance();
      const replacementBatch = next("b", "host-batch");
      expect(replacementBatch.batch.disconnectedPlayerIds).toEqual([1]);
      await match.accept(
        "b",
        replacementBatch.epoch,
        await host.run(replacementBatch.batch),
      );
      const state = next("b", "match-state");
      expect(state.disconnectedPlayerIds).toEqual([1]);
      // An eligible client that stops supplying batches must yield to reserved fallback.
      now += 200;
      await match.advance();
      next("b", "host-batch");
      now += 3100;
      await match.advance();
      await match.advance();
      messages.length = 0;
      await match.advance();
      expect(next("b", "match-state").executor).toBe("server");
      await match.disconnect("b");
      expect(released).toBe(1);
      await match.advance();
      expect(released).toBe(1);
    } finally {
      await worker.close();
    }
  }, 30_000);
});
