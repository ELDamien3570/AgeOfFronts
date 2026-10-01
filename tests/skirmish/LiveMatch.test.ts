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
          request.type === "initialize" ? { ...request, map } : request,
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
      const restore = next("a", "host-restore");
      host.restore(
        await decodeState<ReturnType<Skirmish["checkpoint"]>>(
          restore.checkpoint,
        ),
      );
      match.hostReady("a", restore.epoch, 0, restore.checkpoint.hash);
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
      );
      match.hostReady("b", replacement.epoch, 4, replacement.checkpoint.hash);
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
