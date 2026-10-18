import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { personalityOf } from "../../src/skirmish/content/AiPersonalities";
import { recruitmentVariant } from "../../src/skirmish/content/FormationRecipes";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { militaryDemand } from "../../src/skirmish/domain/AiMilitaryDemand";
import { militaryPosture } from "../../src/skirmish/domain/AiMilitaryPosture";
import { preferredRecruitmentUnit } from "../../src/skirmish/domain/AiRecruitmentPolicy";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { scaledRecipeCost } from "../../src/skirmish/domain/Manpower";

function fixture() {
  const cells = new Uint8Array(96 * 64).fill(133);
  for (let y = 0; y < 64; y++)
    for (let x = 80; x < 96; x++) cells[y * 96 + x] = 0;
  const map = new GameMapImpl(96, 64, cells, cells.length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 2,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    aiEconomy: true,
    diplomacyRules: "raids-v1",
    technologySpeed: 3,
  });
  const saved = game.checkpoint();
  saved.owners.fill(2);
  game.restore(saved);
  const player = game.players[1],
    expansion = game.expansion!;
  player.personalityId = "balanced";
  player.gold = 1000000;
  player.reserves = 2000;
  player.base = map.ref(24, 30);
  game.players[2].base = map.ref(56, 30);
  const state = expansion.progression.states[player.id];
  state.age = "EarlyModern";
  state.completed = TECHNOLOGIES.filter(
    (t) => AGES.indexOf(t.age) <= AGES.indexOf(state.age),
  ).map((t) => t.id);
  const inventory = expansion.supply.inventories[player.id];
  for (const unit of UNITS)
    for (const [item, n] of Object.entries(unit.cost.items ?? {}))
      inventory[item] = n * 1000;
  const snapshot = () =>
    economicSnapshot({
      player,
      age: state.age,
      research: state.completed,
      technologySpeed: 3,
      tick: game.tick,
      generation: game.aiGeneration(player.id),
      inventory,
      buildings: [],
      squads: [],
      ships: [],
      jobs: [],
      production: {},
      cap: 180,
      threatTroops: 0,
      isolated: true,
    });
  return {
    game,
    map,
    player,
    expansion,
    state,
    snapshot,
    personality: personalityOf(player),
  };
}

describe("continuous paid military mobilization", () => {
  it("does not reduce the target when legal capacity or treasury rises", () => {
    const f = fixture(),
      s = f.snapshot();
    const capacity = [60, 100, 180, 200].map(
      (cap) => militaryPosture({ ...s, cap }, f.personality).target,
    );
    expect(capacity).toEqual([...capacity].sort((a, b) => a - b));
    const treasury = [0, 10000, 50000, 100000, 1000000].map(
      (gold) =>
        militaryPosture({ ...s, liquid: { ...s.liquid, gold } }, f.personality)
          .target,
    );
    expect(treasury).toEqual([...treasury].sort((a, b) => a - b));
    expect(capacity[2]).toBe(135);
  });
  it("mobilizes a rich earlier-age island but preserves a poor island opening guard", () => {
    const f = fixture(),
      s = { ...f.snapshot(), age: "Napoleonic" as const, cap: 160 };
    const rich = militaryPosture(s, f.personality);
    expect(rich.wealthy).toBe(false); // Legacy modern-only features retain their meaning.
    expect(rich.mobilizing).toBe(true);
    expect(
      militaryDemand(s, f.personality, new Set()).units.frontline,
    ).toBeGreaterThan(12);
    const poor = { ...s, liquid: { ...s.liquid, gold: 0 } };
    const demand = militaryDemand(poor, f.personality, new Set());
    expect(
      ["frontline", "ranged", "mounted"].reduce(
        (sum, role) => sum + (demand.units[role as "frontline"] ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(12);
  });
  it("uses the same snapshot speed for posture and military demand", () => {
    const f = fixture(),
      slow = {
        ...f.snapshot(),
        technologySpeed: 1 as const,
        liquid: { gold: 125000, reserves: 2000, items: {} },
      };
    const fast = { ...slow, technologySpeed: 3 as const };
    expect(
      militaryPosture(fast, f.personality).developmentGold,
    ).toBeGreaterThan(militaryPosture(slow, f.personality).developmentGold);
    expect(
      militaryDemand(fast, f.personality, new Set()).units.frontline,
    ).toBeGreaterThan(
      militaryDemand(slow, f.personality, new Set()).units.frontline!,
    );
  });
  it("excludes paid research and advancement while retaining the next unpaid research floor", () => {
    const f = fixture(),
      s = {
        ...f.snapshot(),
        research: [] as string[],
        technologySpeed: 1 as const,
      };
    const nodes = TECHNOLOGIES.filter(
      (t) => t.age === s.age && !t.optional && t.tree === "warfare",
    ).sort((a, b) => b.gold - a.gold);
    const first = militaryPosture(s, f.personality),
      paid = militaryPosture(
        { ...s, paidResearch: [nodes[0].id], advancing: true },
        f.personality,
      );
    expect(first.protectedGold - paid.protectedGold).toBe(
      ADVANCES[AGES.indexOf(s.age)].gold +
        nodes[0].gold -
        Math.max(0, ...nodes.slice(1).map((t) => t.gold)),
    );
    expect(paid.protectedGold).toBeGreaterThan(0);
  });
  it("redistributes ordinary peacetime demand over researched core roles", () => {
    const f = fixture(),
      unit = UNITS.find((u) => u.age === "StoneAge" && u.role === "frontline")!;
    const s = {
      ...f.snapshot(),
      age: "StoneAge" as const,
      research: [unit.technologyId],
      cap: 60,
      headroom: 60,
      isolated: false,
      liquid: { gold: 0, reserves: 2000, items: {} },
    };
    const demand = militaryDemand(s, f.personality, new Set());
    expect(demand.units.frontline).toBe(8);
    expect(demand.units.ranged).toBeUndefined();
    expect(demand.units.mounted).toBeUndefined();
    expect(demand.manpower).toBe(
      8 *
        scaledRecipeCost(unit, recruitmentVariant(unit.id, s.research))
          .reserves!,
    );
  });
  it("quotes actual intended formation reserves and preserves the quote across bounded dependency work", () => {
    const f = fixture(),
      s = f.snapshot(),
      demand = militaryDemand(s, f.personality, new Set());
    const expected = Object.entries(demand.units).reduce((sum, [role, n]) => {
      const unit = preferredRecruitmentUnit(
        s,
        role as Parameters<typeof preferredRecruitmentUnit>[1],
      );
      return (
        sum +
        (unit
          ? n! *
            (scaledRecipeCost(unit, recruitmentVariant(unit.id, s.research))
              .reserves ?? 0)
          : 0)
      );
    }, 0);
    expect(demand.manpower).toBe(expected);
    const first = militaryDemand(s, f.personality, new Set(), 0, {}, 1);
    if (first.planning)
      expect(
        militaryDemand(
          s,
          f.personality,
          new Set(),
          0,
          {},
          1,
          structuredClone(first.planning),
        ).manpower,
      ).toBe(first.manpower);
  });
  it("treats a connected peaceful nonallied neighbor as physical competition", () => {
    const f = fixture();
    expect(f.expansion.diplomacy.hostile(f.player.id, 3)).toBe(false);
    const sites = vi
      .spyOn(f.expansion.economy.placements, "candidates")
      .mockReturnValue([]);
    f.expansion.economy.decide(f.player);
    expect(sites.mock.calls[0][1].isolated).toBe(false);
    expect(sites.mock.calls[0][1].technologySpeed).toBe(3);
  });
});
