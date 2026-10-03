import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  AI_PERSONALITIES,
  AI_PERSONALITY,
} from "../../src/skirmish/content/AiPersonalities";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import {
  acceptsAlliance,
  buildingPriority,
  economicBuildingTarget,
  recruitmentOrder,
} from "../../src/skirmish/domain/AiPersonality";
import { Skirmish } from "../../src/skirmish/Simulation";

const profile = (id: Parameters<typeof AI_PERSONALITY.get>[0]) =>
  AI_PERSONALITY.get(id)!;
function match() {
  const data = new Uint8Array(120 * 80).fill(133);
  return new Skirmish(new GameMapImpl(120, 80, data, data.length), {
    seed: 42,
    aiCount: 1,
    runAi: true,
    ruleset: "ages-v1",
  });
}
describe("AI personality policies", () => {
  it("keeps every profile bounded and covers all technology trees", () => {
    for (const p of AI_PERSONALITIES) {
      expect(new Set(p.researchOrder)).toEqual(
        new Set(["economic", "warfare", "naval"]),
      );
      expect(
        p.recruitment.every((n) => Number.isInteger(n) && n >= 1 && n <= 3),
      ).toBe(true);
      expect(p.raidSlots).toBeGreaterThanOrEqual(1);
      expect(p.raidSlots).toBeLessThanOrEqual(3);
      expect(p.interceptRange).toBeLessThanOrEqual(20);
      expect(p.diplomacy.maximumAllies).toBeLessThanOrEqual(3);
      expect(new Set(p.buildingOrder).size).toBe(p.buildingOrder.length);
    }
  });
  it("produces different viable army mixes without starving any troop line", () => {
    const counts = (id: Parameters<typeof AI_PERSONALITY.get>[0]) => {
      const n = { infantry: 0, archer: 0, cavalry: 0 };
      for (let i = 0; i < 60; i++) n[recruitmentOrder(profile(id), n)[0]]++;
      return n;
    };
    const rider = counts("rider"),
      ranger = counts("skirmisher"),
      warden = counts("warden");
    expect(rider.cavalry).toBeGreaterThan(rider.infantry);
    expect(ranger.archer).toBeGreaterThan(ranger.infantry);
    expect(warden.infantry).toBeGreaterThan(warden.cavalry);
    expect(Object.values(rider).every((n) => n >= 10)).toBe(true);
  });
  it("changes economic priority while retaining each legal producer in the plan", () => {
    const types = [
      "city",
      "barracks",
      "factory",
      "archery",
      "stables",
      "port",
    ] as const;
    expect(buildingPriority(profile("merchant"), types)[0]).toBe("factory");
    expect(
      buildingPriority(profile("rider"), types).indexOf("stables"),
    ).toBeLessThan(
      buildingPriority(profile("rider"), types).indexOf("archery"),
    );
    expect(new Set(buildingPriority(profile("merchant"), types))).toEqual(
      new Set(types),
    );
    expect(economicBuildingTarget(profile("builder"), "city", 60)).toBe(2);
    expect(economicBuildingTarget(profile("balanced"), "city", 60)).toBe(1);
    expect(economicBuildingTarget(profile("builder"), "factory", 200)).toBe(8);
  });
  it("uses partner viability and betrayal instead of faction ID for treaties", () => {
    const player = { land: 100 },
      partner = { land: 60, kind: "regular" as const, eliminated: false };
    expect(
      acceptsAlliance(profile("diplomat"), player, partner, 0, false),
    ).toBe(true);
    expect(
      acceptsAlliance(profile("conqueror"), player, partner, 0, false),
    ).toBe(false);
    expect(
      acceptsAlliance(profile("diplomat"), player, partner, 3, false),
    ).toBe(false);
    expect(acceptsAlliance(profile("diplomat"), player, partner, 0, true)).toBe(
      false,
    );
    expect(
      acceptsAlliance(
        profile("diplomat"),
        player,
        { ...partner, kind: "tribe" },
        0,
        false,
      ),
    ).toBe(false);
  });
  it("recruits the preferred cavalry through the real paid command path", () => {
    const game = match(),
      player = game.players[1],
      expansion = game.expansion!;
    player.personalityId = "rider";
    expansion.progression.states[player.id].completed = TECHNOLOGIES.filter(
      (t) => t.age === "StoneAge",
    ).map((t) => t.id);
    const stock = expansion.supply.inventories[player.id];
    stock.horses = 100;
    for (const type of ["barracks", "archery", "stables"] as const) {
      game.addBuilding({
        id: game.allocateId(),
        type,
        playerId: player.id,
        tile: player.base,
        age: "StoneAge",
        remainingTicks: 0,
      });

    }
    const gold = player.gold,
      reserves = player.reserves,
      horses = stock.horses;
    const ids = new Set(game.squads.map((s) => s.id));
    game.tick = 1;
    game.step();
    const job = game.recruitment.jobs.find(j => j.playerId === player.id)!;
    expect(job.kind).toBe("cavalry");
    expect(player.reserves).toBe(reserves - 1000);
    const cost = UNIT.get(job.definitionId!)!.cost;
    expect(player.gold).toBe(gold - (cost.gold ?? 0));
    expect(stock.horses).toBe(horses - (cost.items?.horses ?? 0));
    game.options.runAi = false;
    const ticks = job.remainingTicks;
    for (let i = 0; i < ticks; i++) game.step();
    expect(game.squads.find(s => !ids.has(s.id) && s.playerId === player.id)?.kind).toBe("cavalry");
  });
  it("accepts a player's offer in the real simulation when the diplomat can honor it", () => {
    const game = match(),
      player = game.players[1];
    player.personalityId = "diplomat";
    player.gold = 0;
    expect(
      game.applyCommand({
        type: "alliance",
        playerId: 1,
        otherId: player.id,
        action: "offer",
      }),
    ).toBeNull();
    game.tick = 5;
    game.step();
    expect(game.expansion!.diplomacy.allied(1, player.id)).toBe(true);
    expect(game.expansion!.diplomacy.state.offers).toHaveLength(0);
  });
});
