import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import {
  PRODUCTION_RECIPES,
  productionRejection,
} from "../../src/skirmish/domain/Supply";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

it("projects a waiting production pattern with exact inputs, then a funded job through snapshots", () => {
  const data = new Uint8Array(80 * 40).fill(133),
    m = new Skirmish(new GameMapImpl(80, 40, data, data.length), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
  m.expansion!.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
  const b = {
    id: m.allocateId(),
    type: "factory" as const,
    tile: m.map.ref(10, 10),
    playerId: 1,
    remainingTicks: 0,
    health: 2000,
    maxHealth: 2000,
  };
  m.buildings.push(b);
  const command = {
    type: "produce" as const,
    playerId: 1,
    buildingId: b.id,
    recipeId: "refine-bronze",
  };
  expect(m.applyCommand(command)).toBeNull();
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const state = decoder.decode(encoder.encode(m.snapshot()));
  const selection = {
    selected: new Set<number>(),
    selectedShips: new Set<number>(),
    selectedBuilding: b.id,
  };
  const vm = new EmpireViewModel(state, selection);
  expect(vm.productionStatus(b.id)).toContain("copper 0/8");
  expect(vm.productionChoice(b.id, "refine-bronze").outputs).toEqual([
    { id: "bronze", amount: 10 },
  ]);
  Object.assign(m.expansion!.supply.inventories[1], { copper: 8, tin: 2 });
  m.expansion!.beforeStep();
  const next = new EmpireViewModel(
    decoder.decode(encoder.encode(m.snapshot())),
    selection,
  );
  expect(next.productionStatus(b.id)).toContain("Smelt bronze");
  expect(next.productionChoice(b.id, "refine-bronze").cycleTicks).toBe(
    next.expansion.production[b.id]!.totalTicks,
  );
  expect(next.productionChoice(b.id, "refine-bronze").cycleTicks).toBeLessThan(
    200,
  );
  expect(
    next
      .productionChoice(b.id, "refine-bronze")
      .inputs.find((i) => i.id === "copper")?.available,
  ).toBe(0);
  b.playerId = 2;
  m.expansion!.beforeStep();
  expect(m.snapshot().expansion!.productionPlans[b.id]).toBeUndefined();
  expect(m.snapshot().expansion!.production[b.id]).toBeUndefined();
});
describe("shared production eligibility", () => {
  const recipe = PRODUCTION_RECIPES.find((r) => r.id === "refine-bronze")!,
    b = {
      id: 1,
      type: "factory" as const,
      tile: 0,
      playerId: 1,
      remainingTicks: 0,
      health: 2000,
    };
  it("rejects destroyed, foreign, incomplete and incompatible producers", () => {
    const researched = [recipe.technologyId];
    expect(productionRejection(1, b, recipe, researched)).toBeNull();
    for (const invalid of [
      { ...b, health: 0 },
      { ...b, playerId: 2 },
      { ...b, remainingTicks: 1 },
    ])
      expect(productionRejection(1, invalid, recipe, researched)).toContain(
        "completed owned",
      );
    expect(
      productionRejection(1, { ...b, type: "city" }, recipe, researched),
    ).toContain("cannot make");
    expect(productionRejection(1, b, recipe, [])).toContain("Research");
  });
  it("allows an older workshop to use researched siege equipment while preserving troop producer tiers", () => {
    const siege = PRODUCTION_RECIPES.find(
        (r) => r.id === "make-modern-siege-equipment",
      )!,
      troop = PRODUCTION_RECIPES.find((r) => r.id === "make-modern-equipment")!,
      completed = [siege.technologyId, troop.technologyId];
    expect(
      productionRejection(
        1,
        { ...b, type: "siege-workshop", age: "StoneAge" },
        siege,
        completed,
      ),
    ).toBeNull();
    expect(
      productionRejection(1, { ...b, type: "arms-factory" }, siege, completed),
    ).toContain("cannot make");
    expect(
      productionRejection(
        1,
        { ...b, type: "blacksmith", age: "LateMedieval" },
        troop,
        completed,
      ),
    ).toContain("cannot make");
    expect(
      productionRejection(
        1,
        { ...b, type: "arms-factory", age: "Modern" },
        troop,
        completed,
      ),
    ).toBeNull();
  });
});
