import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { secondsToTicks, type MatchOptions } from "../../src/skirmish/Protocol";
import { PLAYTEST_TRIBE_OPENING, squadCap, tribeMayCampaignAgainstRegular } from "../../src/skirmish/FactionRules";
import { AI_DIFFICULTY } from "../../src/skirmish/content/AiDifficulty";
import { playtestCampaignAllowed } from "../../src/skirmish/domain/PlaytestRules";

const tribe = { kind: "tribe" as const };
function fixture(options: Partial<MatchOptions> = {}) {
  const width = 160, height = 100, cells = new Uint8Array(width * height).fill(133);
  return new Skirmish(new GameMapImpl(width, height, cells, cells.length), {
    seed: 42, aiCount: 1, runAi: false, ruleset: "ages-v1", tribes: true, tribeCount: 2, ...options,
  });
}

describe("playtest tribe opening (13 R1.2-R1.3)", () => {
  it("caps tribe squads at 6 + 4 per age only with the opening", () => {
    expect(PLAYTEST_TRIBE_OPENING).toMatchObject({ startingSquads: 3, squadCap: 6, squadsPerAge: 4, reserveIncomeMultiple: 2 });
    expect(squadCap(tribe, "StoneAge", "playtest-v1")).toBe(6);
    expect(squadCap(tribe, "BronzeAge", "playtest-v1")).toBe(10);
    expect(squadCap(tribe, "Modern", "playtest-v1")).toBe(34);
    expect(squadCap(tribe, "StoneAge")).toBe(10);
    expect(squadCap(tribe, "Modern")).toBe(45);
    expect(squadCap({ kind: "regular" }, "StoneAge", "playtest-v1")).toBe(squadCap({ kind: "regular" }, "StoneAge"));
  });

  it("deploys three tribe squads and applies the cap in the simulation", () => {
    const opened = fixture({ tribeOpening: "playtest-v1" }), historical = fixture();
    for (const [game, squads, cap] of [[opened, 3, 6], [historical, 4, 10]] as const)
      for (const player of game.players.filter(p => p.kind === "tribe")) {
        expect(game.squads.filter(s => s.playerId === player.id)).toHaveLength(squads);
        expect(game.squadCapacity(player)).toBe(cap);
      }
  });

  it("earns twice the base reserve income (24 at Stone instead of 40)", () => {
    const earned = (options: Partial<MatchOptions>) => {
      const game = fixture(options), ids = game.players.filter(p => p.kind === "tribe").map(p => p.id);
      const before = ids.map(id => game.player(id)!.recruited);
      for (let i = 0; i < secondsToTicks(125); i++) game.step();
      return ids.map((id, i) => game.player(id)!.recruited - before[i]);
    };
    // Points per second: 24 base + 8 Stone city = 32, and 40 + 8 = 48
    // historically; 12 reserves per 1000 points over 125 seconds.
    expect(earned({ tribeOpening: "playtest-v1" })).toEqual([48, 48]);
    expect(earned({})).toEqual([72, 72]);
  });

  it("keeps tribes off regular factions before Bronze Age and minute 8", () => {
    const eight = secondsToTicks(8 * 60);
    expect(tribeMayCampaignAgainstRegular("playtest-v1", "BronzeAge", eight - 1)).toBe(false);
    expect(tribeMayCampaignAgainstRegular("playtest-v1", "StoneAge", eight)).toBe(false);
    expect(tribeMayCampaignAgainstRegular("playtest-v1", "BronzeAge", eight)).toBe(true);
    expect(tribeMayCampaignAgainstRegular(undefined, "StoneAge", 0)).toBe(true);
    const allowed = (rival: "regular" | "tribe", actor: "regular" | "tribe" = "tribe") => playtestCampaignAllowed({
      actor: { kind: actor }, rival: { kind: rival }, humanRival: false, commitments: 0, tick: secondsToTicks(7 * 60),
      rules: AI_DIFFICULTY.hard, opening: "playtest-v1", actorAge: "BronzeAge",
    });
    expect(allowed("regular")).toBe(false);
    expect(allowed("tribe")).toBe(true);
    expect(allowed("tribe", "regular")).toBe(true);
  });
});
