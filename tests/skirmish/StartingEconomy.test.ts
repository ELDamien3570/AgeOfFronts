import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingCost, buildingTechnology } from "../../src/skirmish/content/Buildings";
import { startingEconomy } from "../../src/skirmish/content/StartingEconomy";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { defaultUnit } from "../../src/skirmish/content/Units";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { costRejection } from "../../src/skirmish/domain/Supply";
import { tribeBuildingLimit } from "../../src/skirmish/domain/TribeDevelopment";
import type { BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(startingAge: Age) {
  const cells = new Uint8Array(120 * 100).fill(133);
  const m = new Skirmish(new GameMapImpl(120, 100, cells, cells.length), {
    seed: 47, aiCount: 1, tribes: true, tribeCount: 1, runAi: false, ruleset: "ages-v1", startingAge,
  });
  return { m, e: m.expansion!, tribe: m.players.find(p => p.kind === "tribe")! };
}

describe("age-scaled opening resources and tribes", () => {
  it.each(AGES)("gives nations the authored %s opening budget without charging for their initial army", age => {
    const { m, e } = fixture(age), bank = startingEconomy(age);
    for (const p of m.players.filter(p => p.kind === "regular")) {
      expect([p.gold, p.reserves]).toEqual([bank.gold, bank.reserves]);
      for (const [item, n] of Object.entries(bank.items)) expect(e.supply.inventories[p.id][item]).toBe(n);
      expect(m.squads.filter(s => s.playerId === p.id)).toHaveLength(3);
    }
    const types: BuildingType[] = ["city", "city", "barracks", "barracks", "mine", "factory"];
    const smith = age === "Modern" ? "arms-factory" : age === "EarlyModern" ? "armory" : "blacksmith";
    if (buildingTechnology(smith, age)) types.push(smith);
    const counts = new Map<BuildingType, number>(); let gold = 0;
    const items: Record<string, number> = {};
    for (const type of types) {
      const cost = buildingCost(type, age, counts.get(type) ?? 0);
      counts.set(type, (counts.get(type) ?? 0) + 1); gold += cost.gold ?? 0;
      for (const [item, n] of Object.entries(cost.items ?? {})) items[item] = (items[item] ?? 0) + n;
    }
    const unit = defaultUnit("infantry", age); gold += (unit.cost.gold ?? 0) * 2;
    for (const [item, n] of Object.entries(unit.cost.items ?? {})) items[item] = (items[item] ?? 0) + n * 2;
    expect(costRejection(m.players[0], e.supply.inventories[1], { gold, reserves: 2000, items })).toBeNull();
  });
  it.each(AGES)("starts tribes in %s with four matching squads, prior technologies and an age-scaled bank", age => {
    const { m, e, tribe } = fixture(age), state = e.progression.states[tribe.id], bank = startingEconomy(age, true);
    expect(state.age).toBe(age);
    expect([tribe.gold, tribe.reserves]).toEqual([bank.gold, bank.reserves]);
    const units = m.squads.filter(s => s.playerId === tribe.id);
    expect(units).toHaveLength(4);
    expect(units.every(s => s.definitionId === defaultUnit("infantry", age).id)).toBe(true);
    expect(m.buildings.find(b => b.playerId === tribe.id)!.age).toBe(age);
    for (const tech of TECHNOLOGIES.filter(t => AGES.indexOf(t.age) < AGES.indexOf(age))) expect(state.completed).toContain(tech.id);
    expect(m.applyCommand({ type: "advance-age", playerId: tribe.id })).toContain(age === "Modern" ? "final age" : "75%");
    tribe.gold = 1e6;
    const research = TECHNOLOGIES.find(t => t.age === age && !state.completed.includes(t.id) && t.prerequisites.every(id => state.completed.includes(id)))!;
    expect(m.applyCommand({ type: "research", playerId: tribe.id, technologyId: research.id })).toBeNull();
    const wrong = TECHNOLOGIES.find(t => age === "Modern" ? t.age !== age : AGES.indexOf(t.age) > AGES.indexOf(age))!;
    expect(m.applyCommand({ type: "research", playerId: tribe.id, technologyId: wrong.id })).toContain(age === "Modern" ? "already completed" : "Advance to this age first");
  });
  it("enforces one economic and two military structures and rejects types unavailable in the starting age", () => {
    const { m, e, tribe } = fixture("BronzeAge");
    e.progression.states[tribe.id].completed = TECHNOLOGIES.map(t => t.id);
    tribe.gold = 1e6; m.owners.fill(tribe.id); e.supply.replaceDeposits([]);
    const build = (type: BuildingType, x: number) => m.applyCommand({ type: "build", playerId: tribe.id, buildingType: type, tile: m.map.ref(x, 40), age: "BronzeAge" });
    expect(build("city", 10)).toBeNull(); expect(build("city", 20)).toContain("only build 1");
    expect(build("barracks", 30)).toBeNull(); expect(build("barracks", 40)).toContain("only build 2");
    expect(build("airstrip", 50)).toContain("current age");
    expect(tribeBuildingLimit("port", "BronzeAge")).toBe(1);
    expect(tribeBuildingLimit("tower", "BronzeAge")).toBe(2);
  });
  it("bounds tribe placement attempts and checkpoints its cursors", () => {
    const { m, e, tribe } = fixture("BronzeAge");
    e.progression.states[tribe.id].completed = TECHNOLOGIES.map(t => t.id); tribe.gold = 1e6;
    const command = vi.spyOn(m, "applyCommand").mockReturnValue("No legal site");
    const develop = () => (e as unknown as { thinkTribeDevelopment(p: typeof tribe): void }).thinkTribeDevelopment(tribe);
    develop(); expect(command.mock.calls.length).toBeLessThanOrEqual(16);
    const saved = e.checkpoint(); expect(saved.tribePlans).toHaveLength(1);
    e.restore(saved); expect(e.checkpoint().tribePlans).toEqual(saved.tribePlans);
    command.mockRestore();
  });
});
