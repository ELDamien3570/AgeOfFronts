import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import type { Command } from "../../src/skirmish/Protocol";

function fixture(alliances = true) {
  const cells = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, cells, cells.length), {
    seed: 47, aiCount: 2, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: true, alliances,
  });
  const diplomacy = game.expansion!.diplomacy;
  const action = (value: Extract<Command, { type: "alliance" }>["action"], playerId = 1, otherId = 2) =>
    game.applyCommand({ type: "alliance", playerId, otherId, action: value });
  return { game, diplomacy, action };
}

describe("explicit war and long-term alliances", () => {
  it("declares persistent mutual hostility against neutral AI even when alliances are disabled", () => {
    const { game, diplomacy, action } = fixture(false);
    expect(game.expansion!.operations.canTarget(2, 1)).toBe(false);
    const navigation = game.expansion!.operations.navigationRevision(2);
    expect(action("declare")).toBeNull();
    expect(diplomacy.declaredWar(1, 2)).toBe(true);
    expect(diplomacy.declaredWar(2, 1)).toBe(true);
    game.tick = 10000;
    diplomacy.step(game.tick, game.players);
    expect(game.expansion!.operations.canTarget(2, 1)).toBe(true);
    expect(game.expansion!.operations.canEnter(2, 1, game.players[0].base)).toBe(true);
    expect(game.expansion!.operations.canPursue(2, 1, game.players[0].base)).toBe(true);
    expect(game.expansion!.operations.navigationRevision(2)).not.toBe(navigation);
    expect(game.expansion!.events.filter(e => e.action === "declare")).toHaveLength(1);
    expect(action("declare")).toBe("Already at war");
    expect(action("offer-long-term")).toBe("Alliances are disabled for this match");
    game.restore(game.checkpoint());
    expect(game.expansion!.diplomacy.declaredWar(1, 2)).toBe(true);
  });

  it("requires mutual agreement to create and upgrade long-term alliances, and accepting ends explicit war", () => {
    const { game, diplomacy, action } = fixture();
    expect(action("declare")).toBeNull();
    expect(action("offer-long-term")).toBeNull();
    expect(diplomacy.allied(1, 2)).toBe(false);
    expect(action("offer", 2, 1)).toBe("Accept or reject the pending alliance offer");
    expect(action("accept", 2, 1)).toBeNull();
    expect(diplomacy.state.alliances[0].longTerm).toBe(true);
    expect(diplomacy.declaredWar(1, 2)).toBe(false);
    expect(action("offer", 1, 3)).toBeNull();
    expect(action("accept", 3, 1)).toBeNull();
    const regular = diplomacy.state.alliances.find(t => t.a === 3 || t.b === 3)!;
    game.tick = 601;
    expect(action("offer-long-term", 1, 3)).toBeNull();
    const events = game.expansion!.events;
    expect(events[events.length - 1]?.action).toBe("offer-long-term");
    expect(regular.longTerm).toBeUndefined();
    expect(action("accept", 3, 1)).toBeNull();
    expect(regular.longTerm).toBe(true);
  });

  it("auto-renews across skipped boundaries and persists long-term state in snapshots and checkpoints", () => {
    const { game, diplomacy, action } = fixture();
    expect(action("offer-long-term")).toBeNull();
    expect(action("accept", 2, 1)).toBeNull();
    game.tick = 18001;
    const revision = diplomacy.revision;
    diplomacy.step(game.tick, game.players);
    expect(diplomacy.state.alliances[0].expiresTick).toBe(24000);
    expect(diplomacy.revision).toBeGreaterThan(revision);
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    const snapshot = decoder.decode(encoder.encode(game.snapshot()));
    expect(snapshot.expansion!.diplomacy.alliances[0].longTerm).toBe(true);
    game.restore(game.checkpoint());
    expect(game.expansion!.diplomacy.state.alliances[0]).toMatchObject({longTerm: true, expiresTick: 24000});
  });

  it("honors three-minute notice without extension, renewal bypass, or betrayal", () => {
    const { game, diplomacy, action } = fixture();
    expect(action("offer-long-term")).toBeNull();
    expect(action("accept", 2, 1)).toBeNull();
    game.tick = 100;
    expect(action("end-long-term")).toBeNull();
    expect(diplomacy.state.alliances[0]).toMatchObject({ ending: true, expiresTick: 3700 });
    expect(action("end-long-term", 2, 1)).toBe("Alliance is already ending");
    expect(action("renew", 2, 1)).toBe("This alliance is ending");
    game.restore(game.checkpoint());
    const restored = game.expansion!.diplomacy;
    restored.step(3699, game.players);
    expect(restored.allied(1, 2)).toBe(true);
    restored.step(3700, game.players);
    expect(restored.allied(1, 2)).toBe(false);
    expect(restored.state.betrayal[1]).toBeUndefined();
  });

  it.each([["break", 1200], ["declare", 2400]] as const)("applies the correct long-term penalty for %s", (value, penalty) => {
    const { game, diplomacy, action } = fixture();
    expect(action("offer-long-term")).toBeNull();
    expect(action("accept", 2, 1)).toBeNull();
    game.tick = 500;
    expect(action(value)).toBeNull();
    expect(diplomacy.allied(1, 2)).toBe(false);
    expect(diplomacy.state.betrayal[1]).toBe(500 + penalty);
    expect(diplomacy.declaredWar(1, 2)).toBe(value === "declare");
    diplomacy.step(500 + penalty, game.players);
    expect(diplomacy.state.betrayal[1]).toBeUndefined();
  });

  it("accepts new actions through the multiplayer command validator", () => {
    for (const action of ["declare", "offer-long-term", "end-long-term"])
      expect(commandSchema.safeParse({type: "alliance", playerId: 1, otherId: 2, action}).success).toBe(true);
  });
});
