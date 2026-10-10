import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import type { SnapshotPacket } from "../../src/skirmish/Protocol";
import { encodeState, decodeState } from "../../src/skirmish/multiplayer/StateCodec";

describe("allied victory publication", () => {
  it("preserves the coalition in the final delta through the online wire codec", async () => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
      seed: 47, aiCount: 2, tribes: false, runAi: false, ruleset: "ages-v1", alliances: true, victoryMode: "allied",
    });
    expect(game.applyCommand({ type: "alliance", playerId: 1, otherId: 2, action: "offer" })).toBeNull();
    expect(game.applyCommand({ type: "alliance", playerId: 2, otherId: 1, action: "accept" })).toBeNull();
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.snapshot()));
    game.players[2].eliminated = true;
    game.step();
    expect(game.winner).toBe(-1);
    const final = await decodeState<SnapshotPacket>(await encodeState(encoder.encode(game.snapshot())));
    const snapshot = decoder.decode(final);
    expect(snapshot.winner).toBe(-1);
    expect(snapshot.expansion?.winners).toEqual([1, 2]);
    expect(snapshot.expansion!.winners.every(id => snapshot.players.some(p => p.id === id))).toBe(true);
  });
});
