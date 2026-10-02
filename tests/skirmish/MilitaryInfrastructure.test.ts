import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import type { Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  buildingIntegrity,
  buildingTechnology,
} from "../../src/skirmish/content/Buildings";
import { technologyAt } from "../../src/skirmish/content/Technology";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  MILITARY_BUILDINGS,
  modernizeMilitaryBuildings,
} from "../../src/skirmish/domain/MilitaryInfrastructure";
import { startingProgression } from "../../src/skirmish/domain/Progression";

const building = (
  type: Building["type"],
  extra: Partial<Building> = {},
): Building => ({
  id: 1,
  type,
  age: "StoneAge",
  tile: 0,
  playerId: 1,
  remainingTicks: 0,
  health: 600,
  maxHealth: 1200,
  ...extra,
});

describe("research-linked military infrastructure", () => {
  it.each(AGES.slice(1))("uses every building's own unlock in %s", (age) => {
    for (const type of MILITARY_BUILDINGS) {
      const technology = buildingTechnology(type, age);
      if (!technology) continue;
      const state = { ...startingProgression(), age };
      const b = building(type);
      modernizeMilitaryBuildings([b], { 1: state });
      expect(b.age).toBe("StoneAge");
      state.completed.push(technology);
      modernizeMilitaryBuildings([b], { 1: state });
      expect(b.age).toBe(age);
      expect(b.health).toBe(Math.floor(buildingIntegrity(type, age) / 2));
      const before = structuredClone(b);
      modernizeMilitaryBuildings([b], { 1: state });
      expect(b).toEqual(before);
    }
  });
  it("keeps unrelated, unbuilt, destroyed and foreign buildings unchanged", () => {
    const state = { ...startingProgression(), age: "BronzeAge" as const };
    state.completed.push(technologyAt("BronzeAge", "warfare", 1).id);
    const buildings = [
      building("city"),
      building("barracks", { remainingTicks: 1 }),
      building("barracks", { health: 0 }),
      building("barracks", { playerId: 2 }),
    ];
    const before = structuredClone(buildings);
    modernizeMilitaryBuildings(buildings, { 1: state });
    expect(buildings).toEqual(before);
    buildings[1].remainingTicks = 0;
    buildings[3].playerId = 1;
    modernizeMilitaryBuildings(buildings, { 1: state });
    expect(buildings[1].age).toBe("BronzeAge");
    expect(buildings[3].age).toBe("BronzeAge");
  });
  it("upgrades on research completion in the authoritative simulation", () => {
    const cells = new Uint8Array(48 * 48).fill(133);
    const match = new Skirmish(new GameMapImpl(48, 48, cells, cells.length), {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    const e = match.expansion!;
    e.progression.states[1].age = "BronzeAge";
    const t = technologyAt("BronzeAge", "warfare", 1);
    e.progression.states[1].completed.push(...t.prerequisites);
    expect(t.gold).toBe(12000);
    match.players[0].gold = 12000;
    const b = building("barracks", { id: match.allocateId() });
    match.buildings.push(b);
    expect(
      match.applyCommand({ type: "research", playerId: 1, technologyId: t.id }),
    ).toBeNull();
    expect(match.players[0].gold).toBe(0);
    e.beforeStep();
    expect(b.age).toBe("StoneAge");
    e.progression.states[1].research.warfare!.remainingTicks = 1;
    e.beforeStep();
    expect(b.age).toBe("BronzeAge");
    expect(b.health).toBe(780);
  });
});
