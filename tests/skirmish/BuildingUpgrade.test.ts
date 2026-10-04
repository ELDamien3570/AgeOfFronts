import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingCost, buildingIntegrity, buildingUpgradeCost, nextBuildingAge } from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import type { Building } from "../../src/skirmish/Protocol";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const data = new Uint8Array(64 * 64).fill(133);
  const m = new Skirmish(new GameMapImpl(64, 64, data, data.length), {
    seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  const e = m.expansion!, p = m.players[0]; p.gold = 1e6;
  e.progression.states[1].age = "Modern";
  e.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
  m.owners.fill(1);
  function building(type: Building["type"] = "city") {
    const b: Building = m.addBuilding({ id: m.allocateId(), playerId: 1, type, tile: m.map.ref(20, 20),
      age: "StoneAge", health: buildingIntegrity(type, "StoneAge"), maxHealth: buildingIntegrity(type, "StoneAge"), remainingTicks: 0 });
     return b;
  }
  const upgrade = (...buildingIds: number[]) => m.applyCommand({ type: "upgrade-building", playerId: 1, buildingIds });
  return { m, e, p, building, upgrade };
}

describe("explicit paid building upgrades", () => {
  it("advances only one tier with shared half-price gold and rounded-up item costs", () => {
    const all = TECHNOLOGIES.map(t => t.id);
    expect(nextBuildingAge("city", "StoneAge", "Modern", all)).toBe("BronzeAge");
    expect(nextBuildingAge("city", "StoneAge", "Modern", [])).toBeNull();
    expect(nextBuildingAge("tower", "EarlyModern", "Modern", all)).toBeNull();
    const full = buildingCost("tower", "BronzeAge", 1), half = buildingUpgradeCost("tower", "BronzeAge", 1);
    expect(half.gold).toBe(Math.round(full.gold! / 2));
    expect(half.items!.stone).toBe(Math.ceil(full.items!.stone / 2));
  });
  it("deduplicates, spends once, preserves structure identity and blocks recruitment during construction", () => {
    const { m, p, building, upgrade } = fixture(), b = building(), before = p.gold;
    const vm = new EmpireViewModel(m.snapshot(), { selected: new Set(), selectedShips: new Set(), selectedBuilding: b.id, selectedBuildings: new Set([b.id]) });
    const quote = vm.buildingUpgrade()!;
    expect(quote.reason).toBeNull();
    expect(upgrade(b.id, b.id)).toBeNull();
    expect(p.gold).toBe(before - quote.cost.gold!);
    expect(b.age).toBe("BronzeAge");
    expect(b.health).toBe(buildingIntegrity("city", "BronzeAge"));
    expect(b.remainingTicks).toBe(quote.upgrades[0].ticks);
    expect(m.buildings).toHaveLength(1);
    expect(b.remainingTicks).toBeGreaterThan(0);
    expect(upgrade(b.id)).toMatch(/construction/);
  });
  it("validates all identities and aggregate affordability before any mutation", () => {
    const { m, p, building, upgrade } = fixture(), a = building(), b = building();
    const price = buildingUpgradeCost("city", "BronzeAge", 2).gold!;
    p.gold = price;
    expect(upgrade(a.id, b.id)).toMatch(/gold/);
    expect(p.gold).toBe(price); expect(a.age).toBe("StoneAge"); expect(b.age).toBe("StoneAge");
    m.updateBuilding((b).id, { playerId: 2 });
    p.gold = 1e6;
    expect(upgrade(a.id, b.id)).toMatch(/own territory/);
    expect(a.age).toBe("StoneAge"); expect(p.gold).toBe(1e6);
    expect(commandSchema.safeParse({ type: "upgrade-building", playerId: 1, buildingIds: [a.id] }).success).toBe(true);
    expect(m.applyCommand({ type: "upgrade-building", playerId: 1, buildingIds: [] })).not.toBeNull();
  });
  it("does not heal damaged buildings or grant upgrades without researched prerequisites", () => {
    const { m, e, p, building, upgrade } = fixture(), b = building(), gold = p.gold;
    m.updateBuilding((b).id, { health: b.health! - 1 });
    expect(upgrade(b.id)).toMatch(/repair/);
    expect(p.gold).toBe(gold);
    m.updateBuilding((b).id, { health: b.maxHealth });
    e.progression.states[1].completed = [];
    expect(upgrade(b.id)).toMatch(/Research/);
    expect(b.age).toBe("StoneAge");
  });
  it("pauses paid training and supply jobs and restores upgrade construction state", () => {
    const { m, e, building, upgrade } = fixture(), b = building("factory");
    e.supply.jobs[b.id] = { owner: 1, recipeId: "unused-paused", remainingTicks: 50, totalTicks: 50 };
    m.recruitment.enqueue({ playerId: 1, buildingId: b.id, category: "land", kind: "infantry", totalTicks: 100, cost: {} });
    expect(upgrade(b.id)).toBeNull();
    const ticks = b.remainingTicks;
    m.step();
    expect(b.remainingTicks).toBe(ticks - 1);
    expect(e.supply.jobs[b.id]!.remainingTicks).toBe(50);
    expect(m.recruitment.jobs[0].remainingTicks).toBe(100);
    const saved = m.checkpoint(); m.restore(saved);
    expect(m.buildings[0].remainingTicks).toBe(ticks - 1);
    expect(m.buildings[0].age).toBe("BronzeAge");
  });
});
