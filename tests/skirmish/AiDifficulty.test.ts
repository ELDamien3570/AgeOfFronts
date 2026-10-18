import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { secondsToTicks, type MatchOptions } from "../../src/skirmish/Protocol";
import { ARMY_TECHNOLOGY } from "../../src/skirmish/content/Armies";
import { AI_DIFFICULTY, aiRaidAfterTicks } from "../../src/skirmish/content/AiDifficulty";
import { aiDifficultyOf, playtestCampaignAllowed } from "../../src/skirmish/domain/PlaytestRules";

describe("AI difficulty table (13 R4)", () => {
  it("holds the minimum knobs, with hard as today's AI", () => {
    expect(AI_DIFFICULTY.relaxed).toEqual({ raidFloorTicks: secondsToTicks(480), humanCampaignCap: 1, requiredAdvantageAdd: .5, expandingVetoVsHuman: 3 });
    expect(AI_DIFFICULTY.standard).toEqual({ raidFloorTicks: secondsToTicks(240), humanCampaignCap: 2, requiredAdvantageAdd: .2, expandingVetoVsHuman: 2.5 });
    expect(AI_DIFFICULTY.hard).toEqual({ raidFloorTicks: 0, humanCampaignCap: Infinity, requiredAdvantageAdd: 0, expandingVetoVsHuman: 0 });
    expect(aiDifficultyOf(undefined)).toBe("hard");
    expect(aiDifficultyOf({})).toBe("hard");
  });

  it("floors the raid time but keeps a later personality time", () => {
    expect(aiRaidAfterTicks(secondsToTicks(45), AI_DIFFICULTY.hard)).toBe(secondsToTicks(45));
    expect(aiRaidAfterTicks(secondsToTicks(45), AI_DIFFICULTY.standard)).toBe(secondsToTicks(240));
    expect(aiRaidAfterTicks(secondsToTicks(45), AI_DIFFICULTY.relaxed)).toBe(secondsToTicks(480));
    expect(aiRaidAfterTicks(secondsToTicks(600), AI_DIFFICULTY.relaxed)).toBe(secondsToTicks(600));
  });

  it("caps concurrent AI campaigns against one human seat", () => {
    const allowed = (difficulty: keyof typeof AI_DIFFICULTY, commitments: number, humanRival = true) => playtestCampaignAllowed({
      actor: { kind: "regular" }, rival: { kind: "regular" }, humanRival, commitments, tick: 0,
      rules: AI_DIFFICULTY[difficulty], opening: undefined, actorAge: "StoneAge",
    });
    expect(allowed("relaxed", 0)).toBe(true);
    expect(allowed("relaxed", 1)).toBe(false);
    expect(allowed("standard", 1)).toBe(true);
    expect(allowed("standard", 2)).toBe(false);
    expect(allowed("hard", 40)).toBe(true);
    expect(allowed("relaxed", 5, false)).toBe(true);
  });
});

/** Player 1 is the human seat; 2 and 3 are AI. Mirrors the RaidDiplomacy
 * retaliation case, where an AI raided by the human prepares a war. */
function retaliation(options: Partial<MatchOptions>, seconds: number) {
  const cells = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, cells, cells.length), {
    seed: 47, aiCount: 2, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: true, diplomacyRules: "raids-v1", ...options,
  });
  const d = game.expansion!.diplomacy, b = game.players[1];
  b.personalityId = "balanced";
  for (const player of game.players) {
    player.reserves = 2000;
    const template = game.squads.find(s => s.playerId === player.id)!;
    for (let i = 0; i < 12; i++) game.addSquad({ ...structuredClone(template), id: game.allocateId(), x: template.x + i * 256, y: template.y });
  }
  game.players[2].eliminated = true;
  // The retaliation gate compares an actual army after its home reserve:
  // fifteen available squads leave eleven deployable against eleven raiders.
  game.expansion!.progression.states[b.id].age = "BronzeAge";
  game.expansion!.progression.states[b.id].completed.push(ARMY_TECHNOLOGY);
  for (const squad of game.squadFacts().aliveByOwner(1).slice(-4)) game.removeSquad(squad.id);
  const eligible = vi.spyOn(game.expansion!.geography, "eligible").mockReturnValue(true);
  const forces = new Map(game.players.map(p => [p.id, game.squadFacts().aliveByOwner(p.id).length]));
  game.tick = secondsToTicks(seconds);
  game.expansion!.operations.step(forces);
  d.recordTheft(1, b.id, game.tick);
  game.tick += secondsToTicks(15);
  game.expansion!.operations.step(forces);
  eligible.mockRestore();
  return game.expansion!.operations.state(b.id);
}

describe("AI difficulty in the campaign scan", () => {
  it("hard (and an unrecorded difficulty) retaliates at 150 s as today", () => {
    expect(retaliation({}, 150)).toMatchObject({ phase: "preparing", target: 1 });
    expect(retaliation({ aiDifficulty: "hard" }, 150)).toMatchObject({ phase: "preparing", target: 1 });
  });

  it("standard waits for its four-minute raid floor", () => {
    expect(retaliation({ aiDifficulty: "standard" }, 150)?.phase).not.toBe("preparing");
    expect(retaliation({ aiDifficulty: "standard" }, 240)).toMatchObject({ phase: "preparing", target: 1 });
  });
});
