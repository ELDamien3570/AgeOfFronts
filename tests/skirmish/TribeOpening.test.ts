// Balance row "Tribe opening" (05 issue 10 / rec 6; 13 R1(2)(3)). The campaign
// gate is exercised end to end in AiTribeExpansion.test.ts.
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { baseReserveIncome } from "../../src/skirmish/content/Economy";
import {
  squadCap,
  TRIBE_NATION_CAMPAIGN_MIN_AGE,
  TRIBE_NATION_CAMPAIGN_TICKS,
  TRIBE_RESERVE_MULTIPLIER,
  TRIBE_SQUAD_CAP,
  TRIBE_SQUADS_PER_AGE,
  TRIBE_STARTING_SQUADS,
  tribeReserveIncome,
} from "../../src/skirmish/FactionRules";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { secondsToTicks, TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

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
