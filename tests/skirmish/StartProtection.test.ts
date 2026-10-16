import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED, secondsToTicks, type MatchOptions } from "../../src/skirmish/Protocol";
import { startProtectionUntil } from "../../src/skirmish/domain/PlaytestRules";

/** 13 R1.1: human seats start protected; player 1 is the human, 2 and 3 AI. */
function fixture(options: Partial<MatchOptions> = { startProtectionMinutes: 8 }) {
  const cells = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, cells, cells.length), {
    seed: 47, aiCount: 2, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: true,
    diplomacyRules: "raids-v1", ...options,
  });
  return { game, d: game.expansion!.diplomacy, human: game.players[0], ai: game.players[1] };
}
const until = secondsToTicks(8 * 60);

describe("start protection (13 R1.1)", () => {
  it("protects only human seats, until exactly the configured tick", () => {
    const { d } = fixture();
    expect(startProtectionUntil({ startProtectionMinutes: 8 })).toBe(until);
    expect(d.state.startProtection).toEqual([{ playerId: 1, untilTick: until }]);
    expect(d.protected(2, 1, until - 1)).toBe(true);
    expect(d.protected(1, 3, until - 1)).toBe(true);
    expect(d.protected(2, 3, 0)).toBe(false);
    expect(d.protected(1, 0, 0)).toBe(false);
    expect(d.protected(2, 1, until)).toBe(false);
  });

  it("refuses AI raids and wars against a protected human, and its capture", () => {
    const { d, human, ai } = fixture();
    expect(d.establishWar(ai.id, human.id, 10)).toBe("Peace protection is still active");
    expect(d.beginAiRaid(ai, human, 10)).toBe("Peace protection is still active");
    expect(d.action(ai, human, "declare", 10)).toBe("Peace protection is still active");
    expect(d.canCapture(ai.id, human.id)).toBe(false);
    expect(d.state.wars).toEqual([]);
  });

  it("lets the human break its protection by declaring, but not an AI-controlled seat", () => {
    const { game, d, human, ai } = fixture();
    game.setAiController(human.id, true);
    expect(d.action(human, ai, "declare", 10)).toBe("Peace protection is still active");
    expect(d.startProtected(human.id, 10)).toBe(true);
    game.setAiController(human.id, false);
    const revision = d.permissionRevision;
    expect(d.action(human, ai, "declare", 10)).toBeNull();
    expect(d.declaredWar(human.id, ai.id)).toBe(true);
    expect(d.startProtected(human.id, 10)).toBe(false);
    expect(d.state.startProtection).toBeUndefined();
    expect(d.permissionRevision).toBeGreaterThan(revision);
  });

  it("expires in step() and survives a checkpoint round trip", () => {
    const { game, d } = fixture();
    const copy = fixture().game;
    copy.restore(game.checkpoint());
    expect(copy.expansion!.diplomacy.startProtected(1, until - 1)).toBe(true);
    d.step(until - 1, game.players);
    expect(d.state.startProtection).toHaveLength(1);
    d.step(until, game.players);
    expect(d.state.startProtection).toBeUndefined();
    expect(d.startProtectionActive).toBe(false);
  });

  it("rejects a malformed checkpoint row", () => {
    const { game } = fixture();
    const saved = game.checkpoint();
    saved.expansion!.diplomacy.state.startProtection = [{ playerId: 0, untilTick: 5 }];
    expect(() => fixture().game.restore(saved)).toThrow(/diplomacy/);
  });

  it("does not turn a protected human's physical entry into a war", () => {
    const { game, d } = fixture(), s = game.squads.find(s => s.playerId === 1)!;
    for (const other of game.squads) game.updateSquad(other.id, { x: (other.playerId === 1 ? 10 : 80) * FIXED, y: 50 * FIXED, order: { type: "hold" } });
    const state = game.checkpoint(); state.owners.fill(0);
    for (let y = 0; y < 64; y++) for (let x = 30; x < 96; x++) state.owners[game.map.ref(x, y)] = 2;
    game.restore(state);
    game.updateSquad(s.id, { x: 29.9 * FIXED, y: 20.5 * FIXED, order: { type: "move", tile: game.map.ref(34, 20) },
      path: [game.map.ref(30, 20), game.map.ref(31, 20), game.map.ref(32, 20), game.map.ref(34, 20)], nextPathIndex: 0 });
    for (let i = 0; i < 30; i++) game.step();
    expect(d.declaredWar(1, 2)).toBe(false);
    // Movement into protected foreign land is refused, so the squad stays out.
    expect(game.owners[game.tileOf(game.squad(s.id)!)]).not.toBe(2);
  });

  it("keeps the historical rules without the option", () => {
    const { d, human, ai } = fixture({});
    expect(d.state.startProtection).toBeUndefined();
    expect(d.establishWar(ai.id, human.id, 10)).toBeNull();
  });

  it("leaves pairwise peace protection unchanged", () => {
    const { game, d } = fixture({});
    d.recordTheft(1, 2, 0);
    expect(game.applyCommand({ type: "alliance", playerId: 1, otherId: 2, action: "offer-peace" })).toBeNull();
    expect(game.applyCommand({ type: "alliance", playerId: 2, otherId: 1, action: "accept-peace" })).toBeNull();
    expect(d.protected(1, 2)).toBe(true);
    expect(d.action(game.players[0], game.players[1], "declare", 1)).toBe("Peace protection is still active");
  });
});
