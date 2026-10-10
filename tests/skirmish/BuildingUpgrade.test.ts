import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingIntegrity } from "../../src/skirmish/content/Buildings";
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
  for (const b of m.buildings.slice()) m.removeBuilding(b.id);
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

describe("research-driven building upgrades", () => {
  it("offers no paid quote and rejects legacy commands without spending", () => {
    const {m,p,building,upgrade} = fixture(), b=building(), gold=p.gold;
    const vm=new EmpireViewModel(m.snapshot(), {selected:new Set(),selectedShips:new Set(),selectedBuilding:b.id});
    expect(vm.buildingUpgrade()).toBeNull();
    expect(upgrade(b.id,b.id)).toContain("automatically");
    expect(p.gold).toBe(gold);expect(m.buildingFacts().byId(b.id)!.age).toBe("StoneAge");
    expect(commandSchema.safeParse({type:"upgrade-building",playerId:1,buildingIds:[b.id]}).success).toBe(true);
  });
  it("applies researched tiers without payment, reconstruction or free repairs", () => {
    const {m,e,p,building}=fixture(), b=building(), gold=p.gold;
    m.updateBuilding(b.id,{health:600});
    e.beforeStep();
    const upgraded=m.buildingFacts().byId(b.id)!;
    expect(upgraded.age).toBe("Modern");expect(upgraded.id).toBe(b.id);
    expect(upgraded.health!/upgraded.maxHealth!).toBeCloseTo(0.5,3);
    expect(upgraded.remainingTicks).toBe(0);expect(p.gold).toBe(gold);
    const health=upgraded.health;e.beforeStep();expect(m.buildingFacts().byId(b.id)!.health).toBe(health);
    const restored=fixture();restored.m.restore(m.checkpoint());
    expect(restored.m.buildingFacts().byId(b.id)).toEqual(upgraded);
  });
  it("waits for research and for ordinary construction to finish", () => {
    const {m,e,building}=fixture(), b=building();
    e.progression.states[1].completed=[];e.beforeStep();expect(m.buildingFacts().byId(b.id)!.age).toBe("StoneAge");
    e.progression.states[1].completed=TECHNOLOGIES.map(t=>t.id);m.updateBuilding(b.id,{remainingTicks:10});
    e.beforeStep();expect(m.buildingFacts().byId(b.id)!.age).toBe("StoneAge");
    m.updateBuilding(b.id,{remainingTicks:0});e.beforeStep();expect(m.buildingFacts().byId(b.id)!.age).toBe("Modern");
  });
});
