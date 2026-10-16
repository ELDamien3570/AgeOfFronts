import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LAND_INCOME_BASE_GOLD, landGoldIncome } from "../../src/skirmish/content/Economy";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

/** Owner decision OD-6 (05 rec 3): land income `20 x (age + 1) / 2 + land / 40`. */
describe("land income scales with age (OD-6)", () => {
  it("records the rule", () => {
    expect(LAND_INCOME_BASE_GOLD).toBe(20);
    expect(AGES.map((age) => landGoldIncome(age, 0))).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(landGoldIncome("StoneAge", 4000)).toBe(110);
    expect(landGoldIncome("StoneAge", 4000, 2)).toBe(60);
  });
  it("is what the simulation pays each second", () => {
    const data = new Uint8Array(120 * 80).fill(133);
    const game = new Skirmish(new GameMapImpl(120, 80, data, data.length), { seed: 3, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", startingAge: "BronzeAge" });
    for (let i = 0; i < TICKS_PER_SECOND; i++) game.step();
    const player = game.players[0], before = player.gold, land = player.land;
    for (let i = 0; i < TICKS_PER_SECOND; i++) game.step();
    // Gold changes only through income here (no AI, nothing queued).
    expect(player.gold - before).toBe(landGoldIncome("BronzeAge", land));
  });
});
