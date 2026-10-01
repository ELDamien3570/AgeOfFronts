import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import {
  SkirmishViewModel,
  type SelectionState,
} from "../../src/skirmish/client/SkirmishViewModel";
import { buildingTechnology } from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS, VESSELS } from "../../src/skirmish/content/Units";
import { type Age } from "../../src/skirmish/domain/Definitions";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { BUILDING_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(water = false, legacy = false) {
  const terrain = new Uint8Array(96 * 64).fill(133);
  if (water) terrain.fill(0, 25 * 96, 40 * 96);
  const match = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: legacy ? "sandbox-v1" : "ages-v1",
  });
  match.players[0].base = match.map.ref(16, 18);
  match.players[0].gold = 1e6;
  match.players[0].reserves = 1e5;
  if (match.expansion) {
    match.expansion.progression.states[1].age = "Modern";
    match.expansion.progression.states[1].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
    for (const definition of [...UNITS, ...VESSELS])
      for (const item of Object.keys(definition.cost.items ?? {}))
        match.expansion.supply.inventories[1][item] = 10000;
  }
  for (const squad of match.squads) {
    squad.x = 85 * FIXED;
    squad.y = (squad.playerId === 1 ? 3 : 55) * FIXED;
    squad.order = { type: "hold" };
  }
  const selection: SelectionState = {
    selected: new Set(),
    selectedShips: new Set(),
    selectedBuilding: null,
  };
  function building(type: Building["type"], x: number, age: Age = "StoneAge") {
    const y = type === "port" ? 24 : 18;
    const result: Building = {
      id: match.allocateId(),
      type,
      tile: match.map.ref(x, y),
      playerId: 1,
      remainingTicks: 0,
      health: 2000,
      maxHealth: 2000,
      age,
    };
    match.buildings.push(result);
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++) {
        const tile = match.map.ref(x + dx, y + dy);
        if (match.map.isLand(tile)) match.owners[tile] = 1;
      }
    return result;
  }
  const vm = (auto = false, limit?: Age, choices = {}) =>
    new SkirmishViewModel(match.snapshot(), selection, choices, auto, limit);
  return { match, selection, building, vm };
}

describe("selected recruitment building", () => {
  it("names the actual research and specialist recruitment building", () => {
    const { match, selection, vm } = fixture();
    const unit = UNITS.find((u) => u.role === "siege")!;
    const quote = () =>
      vm(false, undefined, { [unit.line]: unit.id }).recruitment(unit.line);
    match.expansion!.progression.states[1].completed = [];
    const technology = TECHNOLOGIES.find((t) => t.id === unit.technologyId)!;
    expect(quote().reason).toContain(technology.name);
    match.expansion!.progression.states[1].completed.push(unit.technologyId);
    expect(quote().reason).toContain(
      BUILDING_RULES[unit.building].name.toLowerCase(),
    );
    expect(quote().reason).toContain("or later");
    const empire = new EmpireViewModel(match.snapshot(), selection);
    const airstripTech = TECHNOLOGIES.find(
      (t) => t.id === buildingTechnology("airstrip", "Modern"),
    )!;
    expect(empire.buildingPreview("airstrip").reason).toContain(
      airstripTech.name,
    );
    expect(empire.buildChoice("airstrip").reason).toContain(airstripTech.name);
  });
  it.each([
    ["infantry", "barracks"],
    ["archer", "archery"],
    ["cavalry", "stables"],
  ] as const)(
    "recruits %s at the selected %s instead of the nearer building",
    (kind, type) => {
      const { match, selection, building, vm } = fixture();
      building(type, 16);
      const selected = building(type, 55);
      selection.selectedBuilding = selected.id;
      const before = vm().state;
      const choice = vm(true).recruitment(kind);
      expect(choice.enabled).toBe(true);
      expect(choice.building?.id).toBe(selected.id);
      expect(match.snapshot()).toEqual(before);
      expect(
        match.applyCommand({
          type: "recruit",
          playerId: 1,
          buildingId: choice.building!.id,
          definitionId: choice.definitionId,
        }),
      ).toBeNull();
      const recruit = match.squads[match.squads.length - 1];
      expect(recruit.kind).toBe(kind);
      expect(
        Math.hypot(recruit.x / FIXED - 55.5, recruit.y / FIXED - 18.5),
      ).toBeLessThan(6);
    },
  );

  it.each(["enemy", "unowned", "unfinished", "wrong type", "missing"] as const)(
    "falls back from a %s selection",
    (reason) => {
      const { match, selection, building, vm } = fixture();
      const nearest = building("barracks", 16);
      const selected = building(
        reason === "wrong type" ? "archery" : "barracks",
        55,
      );
      selection.selectedBuilding = selected.id;
      if (reason === "enemy") selected.playerId = 2;
      if (reason === "unowned") match.owners[selected.tile] = 2;
      if (reason === "unfinished") selected.remainingTicks = 20;
      if (reason === "missing")
        match.buildings.splice(match.buildings.indexOf(selected), 1);
      expect(vm(true).recruitment("infantry").building?.id).toBe(nearest.id);
    },
  );

  it("uses the selected building's best tier before a newer building elsewhere", () => {
    const { match, selection, building, vm } = fixture();
    building("barracks", 16, "Modern");
    const selected = building("barracks", 55, "BronzeAge");
    selection.selectedBuilding = selected.id;
    expect(vm(true).recruitment("infantry")).toMatchObject({
      enabled: true,
      building: { id: selected.id },
      definitionId: "bronzeage-infantry",
    });
    expect(vm(true, "StoneAge").recruitment("infantry").definitionId).toBe(
      "stoneage-infantry",
    );
    match.expansion!.supply.inventories[1]["equipment:bronzeage-infantry"] = 0;
    expect(vm(true).recruitment("infantry")).toMatchObject({
      enabled: true,
      building: { id: selected.id },
      definitionId: "stoneage-infantry",
    });
  });

  it("keeps an explicit tier binding when the selected building cannot train it", () => {
    const { selection, building, vm } = fixture();
    const modern = building("barracks", 16, "Modern");
    const stone = building("barracks", 55);
    selection.selectedBuilding = stone.id;
    expect(
      vm(false, undefined, { infantry: "modern-infantry" }).recruitment(
        "infantry",
      ),
    ).toMatchObject({
      enabled: true,
      building: { id: modern.id },
      definitionId: "modern-infantry",
    });
  });

  it("retains automatic nearest-army selection when no building is selected", () => {
    const { match, selection, building, vm } = fixture();
    const camp = building("barracks", 16);
    const army = building("barracks", 55);
    expect(vm().recruitment("infantry").building?.id).toBe(camp.id);
    const squad = match.squads.find((s) => s.playerId === 1)!;
    squad.x = 55 * FIXED;
    squad.y = 18 * FIXED;
    selection.selected.add(squad.id);
    expect(vm().recruitment("infantry").building?.id).toBe(army.id);
    selection.selectedBuilding = camp.id;
    expect(vm().recruitment("infantry").building?.id).toBe(camp.id);
  });

  it.each(["transport", "warship"] as const)(
    "launches a %s beside the selected port",
    (kind) => {
      const { match, selection, building, vm } = fixture(true);
      building("port", 16, "Modern");
      const selected = building("port", 55);
      selection.selectedBuilding = selected.id;
      const choice = vm(true).recruitment(kind);
      expect(choice).toMatchObject({
        enabled: true,
        building: { id: selected.id },
        definitionId: `stoneage-${kind}`,
      });
      expect(
        match.applyCommand({
          type: "recruit-ship",
          playerId: 1,
          buildingId: choice.building!.id,
          definitionId: choice.definitionId,
          shipType: kind,
        }),
      ).toBeNull();
      expect(match.ships[match.ships.length - 1].x).toBe(55.5 * FIXED);
    },
  );

  it("also gives selection priority in the original squad ruleset", () => {
    const { selection, building, vm } = fixture(false, true);
    building("barracks", 16);
    const selected = building("barracks", 55);
    selection.selectedBuilding = selected.id;
    expect(vm().recruitment("infantry")).toMatchObject({
      enabled: true,
      building: { id: selected.id },
      definitionId: undefined,
    });
  });
});
