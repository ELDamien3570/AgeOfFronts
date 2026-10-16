// Balance row "Tribe opening" (05 issue 10 / rec 6; 13 R1(2)(3)). The campaign
// gate is exercised end to end in AiTribeExpansion.test.ts. The playtest
// opening (Next #3, 13 R1.2-R1.3) now differs only in its starting horde.
import { describe, expect, it } from "vitest";
import { baseReserveIncome } from "../../src/skirmish/content/Economy";
import {
  PLAYTEST_TRIBE_OPENING,
  squadCap,
  tribeMayCampaignAgainstRegular,
  TRIBE_NATION_CAMPAIGN_MIN_AGE,
  TRIBE_NATION_CAMPAIGN_TICKS,
  TRIBE_RESERVE_MULTIPLIER,
  TRIBE_SQUAD_CAP,
  TRIBE_SQUADS_PER_AGE,
  TRIBE_STARTING_SQUADS,
  tribeReserveIncome,
} from "../../src/skirmish/FactionRules";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { secondsToTicks, TICKS_PER_SECOND, type MatchOptions } from "../../src/skirmish/Protocol";
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
  it("keeps the global 6 + 4 per age tribe cap under the opening", () => {
    expect(PLAYTEST_TRIBE_OPENING).toMatchObject({ startingSquads: 3, squadCap: 6, squadsPerAge: 4, reserveIncomeMultiple: 2 });
    expect(squadCap(tribe, "StoneAge", "playtest-v1")).toBe(6);
    expect(squadCap(tribe, "BronzeAge", "playtest-v1")).toBe(10);
    expect(squadCap(tribe, "Modern", "playtest-v1")).toBe(34);
    expect(squadCap(tribe, "StoneAge")).toBe(6);
    expect(squadCap(tribe, "Modern")).toBe(34);
    expect(squadCap({ kind: "regular" }, "StoneAge", "playtest-v1")).toBe(squadCap({ kind: "regular" }, "StoneAge"));
  });

  it("deploys three tribe squads and applies the cap in the simulation", () => {
    const opened = fixture({ tribeOpening: "playtest-v1" }), historical = fixture();
    for (const [game, squads, cap] of [[opened, 3, 6], [historical, 4, 6]] as const)
      for (const player of game.players.filter(p => p.kind === "tribe")) {
        expect(game.squads.filter(s => s.playerId === player.id)).toHaveLength(squads);
        expect(game.squadCapacity(player)).toBe(cap);
      }
  });

  it("earns twice the base reserve income (24 at Stone) with or without the opening", () => {
    const earned = (options: Partial<MatchOptions>) => {
      const game = fixture(options), ids = game.players.filter(p => p.kind === "tribe").map(p => p.id);
      const before = ids.map(id => game.player(id)!.recruited);
      for (let i = 0; i < secondsToTicks(125); i++) game.step();
      return ids.map((id, i) => game.player(id)!.recruited - before[i]);
    };
    // Points per second: 24 base + 8 Stone city = 32 with or without the
    // opening since Next #9 (OD-9; was 40 + 8 historically); 12 reserves per
    // 1000 points over 125 seconds.
    expect(earned({ tribeOpening: "playtest-v1" })).toEqual([48, 48]);
    expect(earned({})).toEqual([48, 48]);
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

describe("tribe opening", () => {
  it("records the owner-decision values (OD-9, OD-10)", () => {
    expect([TRIBE_SQUAD_CAP, TRIBE_SQUADS_PER_AGE, TRIBE_RESERVE_MULTIPLIER, TRIBE_STARTING_SQUADS]).toEqual([6, 4, 2, 4]);
    expect(TRIBE_NATION_CAMPAIGN_TICKS).toBe(secondsToTicks(8 * 60));
    expect(TRIBE_NATION_CAMPAIGN_MIN_AGE).toBe("BronzeAge");
  });
  it("caps tribe squads at 6 plus 4 per age", () => {
    expect(AGES.map(age => squadCap({ kind: "tribe" }, age))).toEqual([6, 10, 14, 18, 22, 26, 30, 34]);
  });
  it("gives tribes twice the nation base reserve income in every age", () => {
    expect(AGES.map(tribeReserveIncome)).toEqual([24, 36, 52, 72, 96, 128, 160, 192]);
    expect(AGES.map(age => tribeReserveIncome(age) / baseReserveIncome(age))).toEqual(AGES.map(() => 2));
  });
  it.each(["StoneAge", "Napoleonic"] as const)("credits a %s tribe's reserve points at the tribe rate", (age: Age) => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
      seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
    });
    const [tribe, nation] = game.players;
    tribe.kind = "tribe";
    for (const p of game.players) game.expansion!.progression.states[p.id].age = age;
    for (const b of game.buildings.filter(b => b.type === "city")) game.removeBuilding(b.id);
    // Reserve points become soldiers at 12 per 1000 points, carrying the remainder.
    const soldiers = (player: typeof tribe, points: number) => Math.floor((points * 12 + (player.reserveRemainder ?? 0)) / 1000);
    const expected = [soldiers(tribe, 100 * tribeReserveIncome(age)), soldiers(nation, 100 * baseReserveIncome(age))];
    const before = [tribe.recruited, nation.recruited];
    for (let i = 0; i < TICKS_PER_SECOND * 100; i++) game.step();
    expect(tribe.recruited - before[0]).toBe(expected[0]);
    expect(nation.recruited - before[1]).toBe(expected[1]);
    expect(expected[0]).toBeGreaterThan(expected[1]);
  });
});
