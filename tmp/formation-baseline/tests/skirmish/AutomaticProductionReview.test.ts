import { expect, it } from "vitest";
import { PRODUCTION_RECIPES } from "../../src/skirmish/content/Production";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { automaticProduction } from "../../src/skirmish/domain/AutomaticProduction";
import type { Building } from "../../src/skirmish/Protocol";

it("preserves advanced troop capacity when an older producer has a manual priority", () => {
  const buildings: Building[] = [
    {
      id: 1,
      type: "arms-factory",
      playerId: 1,
      tile: 0,
      age: "Modern",
      remainingTicks: 0,
    },
    {
      id: 2,
      type: "blacksmith",
      playerId: 1,
      tile: 1,
      age: "BronzeAge",
      remainingTicks: 0,
    },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: {
      bronze: 1000,
      iron: 1000,
      steel: 1000,
      gunpowder: 1000,
      oil: 1000,
    },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(),
    squadCount: 0,
    ai: false,
    priorities: { blacksmith: ["make-bronzeage-equipment"] },
  });
  expect(result.get(1)).toBe("make-modern-equipment");
  expect(result.get(2)).toBe("make-bronzeage-equipment");
});

it("uses an older workshop before tying up an advanced factory for a single old-tier shortfall", () => {
  const buildings: Building[] = [
    {
      id: 1,
      type: "arms-factory",
      playerId: 1,
      tile: 0,
      age: "Modern",
      remainingTicks: 0,
    },
    {
      id: 2,
      type: "blacksmith",
      playerId: 1,
      tile: 1,
      age: "BronzeAge",
      remainingTicks: 0,
    },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: {
      bronze: 1000,
      steel: 1000,
      gunpowder: 1000,
      "equipment:modern": 6,
      "equipment:bronzeage": 5,
    },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(),
    squadCount: 0,
    ai: false,
    priorities: { blacksmith: ["make-bronzeage-equipment"] },
  });
  expect([...result]).toEqual([[2, "make-bronzeage-equipment"]]);
});

it("does not let an unfunded older kit reserve the iron needed for advanced equipment's affordable steel", () => {
  const buildings: Building[] = [
    { id: 1, type: "arms-factory", playerId: 1, tile: 0, remainingTicks: 0 },
    { id: 2, type: "blacksmith", playerId: 1, tile: 1, remainingTicks: 0 },
    { id: 3, type: "factory", playerId: 1, tile: 2, remainingTicks: 0 },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: { iron: 10, carbon: 2, gunpowder: 10, ironOre: 0 },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(["ironOre"]),
    squadCount: 0,
    ai: false,
    priorities: { blacksmith: ["make-classicalage-equipment"] },
  });
  expect(result.get(3)).toBe("refine-steel");
});

it("waits for funded refining output instead of funding the same immediate dependency twice", () => {
  const buildings: Building[] = [
    { id: 1, type: "arms-factory", playerId: 1, tile: 0, remainingTicks: 0 },
    { id: 2, type: "blacksmith", playerId: 1, tile: 1, remainingTicks: 0 },
    { id: 3, type: "factory", playerId: 1, tile: 2, remainingTicks: 0 },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: { iron: 10, carbon: 2, gunpowder: 10, ironOre: 0 },
    incoming: { steel: 12 },
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(["ironOre"]),
    squadCount: 0,
    ai: false,
    priorities: { blacksmith: ["make-classicalage-equipment"] },
  });
  expect(result.has(3)).toBe(false);
});

it("funds only an affordable first stage when the advanced refining chain needs several batches", () => {
  const buildings: Building[] = [
    { id: 1, type: "arms-factory", playerId: 1, tile: 0, remainingTicks: 0 },
    { id: 2, type: "factory", playerId: 1, tile: 1, remainingTicks: 0 },
    { id: 3, type: "factory", playerId: 1, tile: 2, remainingTicks: 0 },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: { ironOre: 10, carbon: 2, gunpowder: 10 },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(["ironOre", "carbon"]),
    squadCount: 0,
    ai: false,
  });
  expect([...result.values()]).toEqual(["refine-iron"]);
});

it("keeps a blacksmith group's manual Bronze priority from recruiting a default arms factory", () => {
  const buildings: Building[] = [
    { id: 1, type: "arms-factory", playerId: 1, tile: 0, remainingTicks: 0 },
    { id: 2, type: "blacksmith", playerId: 1, tile: 1, remainingTicks: 0 },
  ];
  const result = automaticProduction({
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: {
      bronze: 1000,
      iron: 1000,
      steel: 1000,
      gunpowder: 1000,
      "equipment:modern": 6,
    },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set([2]),
    renewable: new Set(),
    squadCount: 0,
    ai: false,
    priorities: { blacksmith: ["make-bronzeage-equipment"] },
  });
  expect(result.has(1)).toBe(false);
});

it("honors each automatic type's highlighted pattern without splitting the newest tier's main buffer", () => {
  const buildings: Building[] = [
    { id: 1, type: "arms-factory", playerId: 1, tile: 0, remainingTicks: 0 },
    { id: 2, type: "blacksmith", playerId: 1, tile: 1, remainingTicks: 0 },
  ];
  const context = {
    buildings,
    research: TECHNOLOGIES.map((t) => t.id),
    inventory: {
      steel: 100,
      gunpowder: 100,
      "equipment:modern": 6,
      "equipment:latemedieval": 0,
    },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set<number>(),
    renewable: new Set<string>(),
    squadCount: 0,
    ai: false,
  };
  const result = automaticProduction(context);
  expect(result.get(1)).toBe("make-modern-equipment");
  expect(result.get(2)).toBe("make-latemedieval-equipment");
  context.inventory["equipment:latemedieval"] = 2;
  expect(automaticProduction(context).has(2)).toBe(false);
});
