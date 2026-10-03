import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { militaryProduction } from "../../src/skirmish/domain/AiMilitaryDevelopment";
import { PRODUCTION_RECIPES } from "../../src/skirmish/domain/Supply";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
function setup() {
  const data = new Uint8Array(96 * 64).fill(133),
    m = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: true,
      ruleset: "ages-v1",
    });
  const p = m.players[1],
    e = m.expansion!,
    stock = e.supply.inventories[p.id];
  e.progression.states[p.id].age = "Modern";
  e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id);
  p.gold = 1000000;
  p.reserves = 0;
  for (const squad of m.squads) {
    m.updateSquad(squad.id, { x: ((squad.playerId === 2 ? p.base % 96 : 2) + 0.5) * FIXED });
    m.updateSquad(squad.id, { y: ((squad.playerId === 2 ? Math.floor(p.base / 96) : 2) + 0.5) * FIXED });
  }
  const b: Building = m.addBuilding({
    id: m.allocateId(),
    type: "arms-factory",
    tile: p.base,
    playerId: p.id,
    age: "Modern",
    remainingTicks: 0,
    health: 2000,
    maxHealth: 2000,
  });

  return { m, e, p, stock, b };
}
describe("AI equipment production and refit rotation", () => {
  it("plans newest kits and their refining dependencies rather than repeating obsolete stock", () => {
    const { e, p, b } = setup(),
      factory = { ...b, id: b.id + 1, type: "factory" as const };
    const plans = militaryProduction(
      [b, factory],
      e.progression.states[p.id].completed,
      {
        steel: 100,
        gunpowder: 100,
        ironOre: 100,
        carbon: 100,
        nitrate: 100,
        sulphur: 100,
        oil: 100,
      },
      PRODUCTION_RECIPES,
      {},
      80,
    );
    expect(plans.get(b.id)).toMatch(
      /^make-modern-(equipment|siege-equipment|vehicle-equipment)$/,
    );
    expect(plans.get(factory.id)).toMatch(/^refine-(iron|steel|gunpowder)$/);
  });
  it("finishes the paid old batch, then produces the new tier without refunding or granting inputs", () => {
    const { m, e, p, stock, b } = setup();
    Object.assign(stock, { bronze: 12, steel: 100, gunpowder: 100 });
    expect(
      m.applyCommand({
        type: "produce",
        playerId: p.id,
        buildingId: b.id,
        recipeId: "make-bronzeage-equipment",
      }),
    ).toBeNull();
    e.supply.step(1, m.players, m.buildings, m.owners);
    expect(stock.bronze).toBe(0);
    for (let i = 0; i < 55; i++) m.step();
    expect(e.supply.jobs[b.id]?.recipeId).toBe("make-bronzeage-equipment");
    expect(e.supply.productionPlans()[b.id].recipeId).toBe(
      "make-bronzeage-equipment",
    );
    // AI shares the player allocator and never overwrites explicit controls.
    expect(e.supply.setProduction(p, b, "auto")).toBeNull();
    for (let i = 0; i < 450; i++)
      e.supply.step(m.tick + i + 1, m.players, m.buildings, m.owners);
    expect(stock["equipment:bronzeage"]).toBe(1);
    expect(e.supply.jobs[b.id]?.recipeId).toMatch(/^make-modern-/);
    expect(stock.steel).toBeLessThan(100);
  });
  it("holds a minority of moving squads and completes a paid refit instead of immediately overwriting the order", () => {
    const { m, e, p, stock } = setup(),
      own = m.squads.filter((s) => s.playerId === p.id);
    stock["equipment:modern"] = 1;
    for (const s of own) {
      m.updateSquad(s.id, { moved: true });
      m.updateSquad(s.id, { order: { type: "move", tile: p.base } });
    }
    for (let i = 0; i < 55; i++) m.step();
    expect(
      own.filter((s) => e.modernization.holds(s.id) || s.refit),
    ).toHaveLength(1);
    for (let i = 0; i < 300; i++) m.step();
    expect(
      own.filter((s) => s.definitionId === "modern-infantry"),
    ).toHaveLength(1);
    expect(stock["equipment:modern"]).toBe(0);
    expect(own.every((s) => !e.modernization.holds(s.id))).toBe(true);
  });
  it("does not refit or reserve units without their equipment", () => {
    const { m, e, p, stock } = setup(),
      own = m.squads.filter((s) => s.playerId === p.id);
    e.modernization.reserve(
      p,
      own,
      e.progression.states[p.id].completed,
      stock,
      0,
    );
    expect(e.modernization.leases.size).toBe(0);
  });
  it("stopping a repeat plan still completes its paid batch and rejects foreign producers", () => {
    const { m, e, p, stock, b } = setup();
    stock.steel = 12;
    stock.gunpowder = 10;
    expect(e.supply.setProduction(p, b, "make-modern-equipment")).toBeNull();
    e.supply.step(1, m.players, m.buildings, m.owners);
    expect(e.supply.setProduction(m.players[0], b, null)).not.toBeNull();
    expect(e.supply.setProduction(p, b, null)).toBeNull();
    for (let i = 0; i < 900; i++)
      e.supply.step(i + 2, m.players, m.buildings, m.owners);
    expect(stock["equipment:modern"]).toBe(1);
    expect(e.supply.jobs[b.id]).toBeUndefined();
  });
});
