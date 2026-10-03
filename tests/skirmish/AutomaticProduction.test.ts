import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { equipmentItem } from "../../src/skirmish/content/Equipment";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import {
  automaticProduction,
  type AutomaticProductionContext,
} from "../../src/skirmish/domain/AutomaticProduction";
import { PRODUCTION_RECIPES } from "../../src/skirmish/domain/Supply";
import type { Building, BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

const research = TECHNOLOGIES.map((t) => t.id);
const building = (id: number, type: BuildingType): Building => ({
  id,
  type,
  playerId: 1,
  tile: 0,
  remainingTicks: 0,
  age: "Modern",
});
const goods = {
  steel: 1000,
  iron: 1000,
  bronze: 1000,
  copper: 1000,
  tin: 1000,
  ironOre: 1000,
  carbon: 1000,
  gunpowder: 1000,
  oil: 1000,
  stone: 1000,
};
function plan(overrides: Partial<AutomaticProductionContext> = {}) {
  return automaticProduction({
    buildings: [
      building(1, "arms-factory"),
      building(2, "siege-workshop"),
      building(3, "depot"),
    ],
    research,
    inventory: { ...goods },
    incoming: {},
    recipes: PRODUCTION_RECIPES,
    plans: new Map(),
    busy: new Set(),
    renewable: new Set(),
    squadCount: 6,
    ai: false,
    ...overrides,
  });
}
function setup() {
  const data = new Uint8Array(96 * 64).fill(133);
  const m = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const e = m.expansion!,
    p = m.players[0],
    stock = e.supply.inventories[p.id];
  e.progression.states[p.id].completed = research;
  e.progression.states[p.id].age = "Modern";
  p.gold = 1_000_000;
  p.reserves = 100_000;
  const add = (type: BuildingType) => {
    const b = m.addBuilding({ ...building(m.allocateId(), type), tile: p.base });

    return b;
  };
  const step = (tick: number) =>
    e.supply.step(tick, m.players, m.buildings, m.owners, m.squads);
  return { m, e, p, stock, add, step };
}

describe("shared automatic production allocation", () => {
  it("uses each specialty's newest researched pattern", () => {
    expect([...plan().values()]).toEqual([
      "make-modern-equipment",
      "make-modern-siege-equipment",
      "make-modern-vehicle-equipment",
    ]);
    expect(plan({ buildings: [building(1, "blacksmith")] }).get(1)).toBe(
      "make-latemedieval-equipment",
    );
    expect(plan({ buildings: [building(1, "armory")] }).get(1)).toBe(
      "make-earlymodern-equipment",
    );
    expect(plan({ research: [] }).size).toBe(0);
  });
  it("falls back when advanced inputs have no sustainable source, but saves for a reachable tier", () => {
    expect(
      plan({
        inventory: { bronze: 12 },
        buildings: [building(1, "arms-factory")],
      }).get(1),
    ).toBe("make-bronzeage-equipment");
    const buildings = [building(1, "arms-factory"), building(2, "factory")];
    const next = plan({
      buildings,
      inventory: { bronze: 12, ironOre: 10, carbon: 2, gunpowder: 10 },
    });
    expect(next.has(1)).toBe(false);
    expect(next.get(2)).toBe("refine-iron");
  });
  it("makes advanced metal first and then its prerequisite without permanently starving older demanded metal", () => {
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ...goods, steel: 0 },
      }).get(1),
    ).toBe("refine-steel");
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ironOre: 10, carbon: 2 },
      }).get(1),
    ).toBe("refine-iron");
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ...goods, steel: 120 },
      }).size,
    ).toBe(0);
  });
  it("reserves scarce shared inputs for underserved troop kits ahead of a bank of depots", () => {
    const buildings = [
      ...Array.from({ length: 20 }, (_, i) => building(i + 1, "depot")),
      building(30, "arms-factory"),
    ];
    expect([
      ...plan({ buildings, inventory: { steel: 30, oil: 100, gunpowder: 10 } }),
    ]).toEqual([[30, "make-modern-equipment"]]);
    const waiting = plan({
      buildings,
      inventory: { steel: 10, oil: 100, gunpowder: 10 },
      renewable: new Set(["steel"]),
    });
    expect(waiting.size).toBe(0);
  });
  it("shares materials with an underserved vehicle line rather than filling every troop buffer first", () => {
    const result = plan({
      inventory: { steel: 30, gunpowder: 100, oil: 20 },
      incoming: {
        [equipmentItem("Modern")]: 6,
        [equipmentItem("Modern", "siege")]: 4,
      },
    });
    expect([...result.values()]).toEqual(["make-modern-vehicle-equipment"]);
  });
  it("bounds global and in-flight stock even with many producers, and supplies both vehicle components", () => {
    const buildings = ["arms-factory", "siege-workshop", "depot"].flatMap(
      (type, group) =>
        Array.from({ length: 40 }, (_, i) =>
          building(group * 40 + i, type as BuildingType),
        ),
    );
    const values = [
      ...plan({
        buildings,
        inventory: { ...goods, steel: 10000, gunpowder: 10000 },
      }).values(),
    ];
    expect(values.filter((v) => v === "make-modern-equipment")).toHaveLength(
      40,
    );
    expect(
      values.filter((v) => v === "make-modern-siege-equipment"),
    ).toHaveLength(4);
    expect(
      values.filter((v) => v === "make-modern-vehicle-equipment"),
    ).toHaveLength(2);
    expect(
      plan({
        incoming: {
          [equipmentItem("Modern")]: 12,
          [equipmentItem("Modern", "siege")]: 4,
          [equipmentItem("Modern", "vehicle")]: 2,
        },
      }).size,
    ).toBe(0);
  });
  it("is independent of building insertion order, does not mutate inputs, and excludes paused/manual/busy producers", () => {
    const buildings = [
        building(9, "depot"),
        building(4, "siege-workshop"),
        building(2, "arms-factory"),
      ],
      inventory = { ...goods, steel: 42 };
    expect([...plan({ buildings, inventory })]).toEqual([
      ...plan({ buildings: [...buildings].reverse(), inventory }),
    ]);
    expect(inventory.steel).toBe(42);
    expect(
      plan({
        buildings,
        busy: new Set([9]),
        plans: new Map([
          [4, { owner: 1, recipeId: "paused" }],
          [2, { owner: 1, recipeId: "make-bronzeage-equipment" }],
        ]),
      }).size,
    ).toBe(0);
    expect(
      plan({ buildings: buildings.map((b) => ({ ...b, health: 0 })) }).size,
    ).toBe(0);
    expect(
      plan({ buildings: buildings.map((b) => ({ ...b, remainingTicks: 1 })) })
        .size,
    ).toBe(0);
  });
  it("does not auto-build human strategic payloads or let AI payloads compete with troop deficits", () => {
    expect(
      [...plan({ ai: true }).values()].some((r) => r.startsWith("make-icbm")),
    ).toBe(false);
    const inventory = { ...goods, [equipmentItem("Modern")]: 12 };
    expect(
      plan({ buildings: [building(1, "arms-factory")], inventory }).size,
    ).toBe(0);
    expect(
      [
        ...plan({
          buildings: [building(1, "arms-factory")],
          inventory,
          ai: true,
        }).values(),
      ][0],
    ).toMatch(/^make-(hydrogen|icbm|mirv)$/);
  });
});

describe("automatic paid-batch lifecycle", () => {
  it("starts without commands for either human or AI and debits exactly once", () => {
    for (const ai of [false, true]) {
      const { e, p, stock, add, step } = setup();
      p.ai = ai;
      const b = add("arms-factory");
      Object.assign(stock, { steel: 12, gunpowder: 10 });
      step(20);
      expect(e.supply.jobs[b.id]?.recipeId).toBe("make-modern-equipment");
      expect(stock.steel).toBe(0);
      expect(stock.gunpowder).toBe(0);
      const ticks = e.supply.jobs[b.id]!.remainingTicks;
      for (let tick = 21; tick <= 20 + ticks; tick++) step(tick);
      expect(stock[equipmentItem("Modern")]).toBe(1);
      expect(e.supply.jobs[b.id]).toBeUndefined();
    }
  });
  it("finishes paid work when paused, respects manual overrides beyond auto targets, and resumes automatically", () => {
    const { e, p, stock, add, step } = setup(),
      b = add("arms-factory");
    Object.assign(stock, goods);
    step(20);
    const job = e.supply.jobs[b.id]!;
    expect(e.supply.setProduction(p, b, null)).toBeNull();
    const paid = { ...stock };
    for (let t = 21; t <= 20 + job.totalTicks + 40; t++) step(t);
    expect(stock.steel).toBe(paid.steel);
    expect(stock[equipmentItem("Modern")]).toBe(1);
    expect(e.supply.jobs[b.id]).toBeUndefined();
    stock[equipmentItem("Modern")] = 50;
    expect(e.supply.setProduction(p, b, "make-modern-equipment")).toBeNull();
    step(2001);
    expect(e.supply.jobs[b.id]).toBeDefined();
    expect(e.supply.setProduction(p, b, "auto")).toBeNull();
    expect(e.supply.productionPlans()[b.id]).toBeUndefined();
    e.supply.jobs[b.id]!.remainingTicks = 1;
    step(2020);
    expect(stock[equipmentItem("Modern")]).toBe(51);
    expect(e.supply.jobs[b.id]).toBeUndefined();
    stock[equipmentItem("Modern")] = 0;
    step(2040);
    expect(e.supply.jobs[b.id]).toBeDefined();
  });
  it.each(["capture", "destroy", "health", "eliminate"])(
    "discards automatic work on %s without paying its output to another owner",
    (reason) => {
      const { m, e, p, stock, add, step } = setup(),
        b = add("arms-factory");
      Object.assign(stock, { steel: 12, gunpowder: 10 });
      step(20);
      if (reason === "capture") m.updateBuilding((b).id, { playerId: 2 });
      else if (reason === "destroy")
        m.removeBuilding(b.id);
      else if (reason === "health") m.updateBuilding((b).id, { health: 0 });
      else p.eliminated = true;
      step(21);
      expect(e.supply.jobs[b.id]).toBeUndefined();
      expect(stock.steel).toBe(0);
      expect(stock[equipmentItem("Modern")] ?? 0).toBe(0);
      expect(e.supply.inventories[2][equipmentItem("Modern")] ?? 0).toBe(0);
    },
  );
  it("restores paid jobs and pause/manual modes deterministically across checkpoints", () => {
    const { e, p, stock, add, step } = setup(),
      a = add("arms-factory"),
      b = add("depot");
    Object.assign(stock, goods);
    e.supply.setProduction(p, b, null);
    step(20);
    const checkpoint = e.supply.checkpoint();
    for (let t = 21; t < 1400; t++) step(t);
    const expected = e.supply.checkpoint();
    e.supply.restore(checkpoint);
    for (let t = 21; t < 1400; t++) step(t);
    expect(e.supply.checkpoint()).toEqual(expected);
    expect(e.supply.productionPlans()[b.id].recipeId).toBe("paused");
    expect(e.supply.jobs[a.id]?.recipeId).toBe("make-modern-equipment");
  });
  it("produces siege components passively, then reserves one per actual recruitment and refunds capture once", () => {
    const { m, e, p, stock, add, step } = setup(),
      b = add("siege-workshop");
    Object.assign(stock, { steel: 20, gunpowder: 10 });
    step(20);
    const ticks = e.supply.jobs[b.id]!.remainingTicks;
    for (let t = 21; t <= 20 + ticks; t++) step(t);
    const kit = equipmentItem("Modern", "siege");
    expect(stock[kit]).toBe(1);
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: p.id,
        buildingId: b.id,
        definitionId: "modern-siege",
      }),
    ).toBeNull();
    expect(stock[kit]).toBe(0);
    expect(stock.steel).toBe(0);
    expect(stock.gunpowder).toBe(0);
    expect(m.recruitment.jobs[0].cost.items).toEqual({ [kit]: 1 });
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: p.id,
        buildingId: b.id,
        definitionId: "modern-siege",
      }),
    ).not.toBeNull();
    m.updateBuilding((b).id, { playerId: 2 });
    m.step();
    expect(stock[kit]).toBe(1);
    expect(m.recruitment.jobs).toHaveLength(0);
    m.step();
    expect(stock[kit]).toBe(1);
  });
  it("consumes a produced siege kit only once when completed training deploys", () => {
    const { m, p, stock, add } = setup(),
      b = add("siege-workshop"),
      kit = equipmentItem("Modern", "siege");
    stock[kit] = 1;
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: p.id,
        buildingId: b.id,
        definitionId: "modern-siege",
      }),
    ).toBeNull();
    for (let t = 0; t < 450; t++) m.step();
    expect(
      m.squads.some(
        (s) => s.playerId === p.id && s.definitionId === "modern-siege",
      ),
    ).toBe(true);
    expect(stock[kit]).toBe(0);
    expect(m.recruitment.jobs).toHaveLength(0);
  });
});

describe("persistent building-type priorities", () => {
  it("splits a shared troop buffer across manual patterns and keeps vehicle competition bounded", () => {
    const buildings = Array.from({ length: 30 }, (_, i) =>
      building(i, "arms-factory"),
    );
    const values = [
      ...plan({
        buildings,
        priorities: {
          "arms-factory": ["make-modern-equipment", "make-bronzeage-equipment"],
        },
      }).values(),
    ];
    expect(values.filter((v) => v === "make-modern-equipment")).toHaveLength(15);
    expect(values.filter((v) => v === "make-bronzeage-equipment")).toHaveLength(
      15,
    );
    const scarce = plan({
      buildings: [building(1, "depot"), building(2, "arms-factory")],
      inventory: { steel: 30, gunpowder: 10, oil: 20 },
      priorities: { depot: ["make-modern-vehicle-equipment"] },
    });
    expect([...scarce.values()]).toEqual(["make-modern-equipment"]);
  });
  it("manual factory priorities retain prerequisite iron and allow multiple smelting choices", () => {
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ironOre: 10, carbon: 2 },
        priorities: { factory: ["refine-steel"] },
      }).get(1),
    ).toBe("refine-iron");
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ...goods, bronze: 0, steel: 0 },
        priorities: { factory: ["refine-bronze"] },
      }).get(1),
    ).toBe("refine-bronze");
    expect(
      plan({
        buildings: [building(1, "factory")],
        inventory: { ...goods, bronze: 0, steel: 30 },
        priorities: { factory: ["refine-bronze", "refine-steel"] },
      }).get(1),
    ).toBe("refine-bronze");
  });
  it("persists manual choices through age/research changes and applies them to new buildings", () => {
    const { m, e, p, stock, add, step } = setup(),
      a = add("arms-factory");
    Object.assign(stock, goods);
    expect(
      m.applyCommand({
        type: "production-priority",
        playerId: p.id,
        buildingType: "arms-factory",
        recipeIds: ["make-bronzeage-equipment"],
      }),
    ).toBeNull();
    e.progression.states[p.id].age = "BronzeAge";
    e.progression.states[p.id].completed = [
      PRODUCTION_RECIPES.find((r) => r.id === "make-bronzeage-equipment")!
        .technologyId,
    ];
    step(20);
    expect(e.supply.jobs[a.id]?.recipeId).toBe("make-bronzeage-equipment");
    e.progression.states[p.id].age = "Modern";
    e.progression.states[p.id].completed = research;
    const b = add("arms-factory");
    step(40);
    expect(e.supply.jobs[b.id]?.recipeId).toBe("make-bronzeage-equipment");
    expect(
      m.snapshot().expansion!.productionPriorities?.[p.id]["arms-factory"],
    ).toEqual(["make-bronzeage-equipment"]);
    expect(
      m.applyCommand({ type: "reset-production-priorities", playerId: p.id }),
    ).toBeNull();
    const c = add("arms-factory");
    step(60);
    expect(e.supply.jobs[c.id]?.recipeId).toBe("make-modern-equipment");
    expect(e.supply.jobs[a.id]?.recipeId).toBe("make-bronzeage-equipment");
    expect(e.supply.priorities[p.id]).toBeUndefined();
  });
  it("validates ownership, research and compatibility atomically, but allows settings during construction", () => {
    const { m, e, p, add } = setup(),
      a = add("arms-factory");
    m.updateBuilding((a).id, { remainingTicks: 100 });
    const set = (recipeIds: string[] | null) =>
      m.applyCommand({
        type: "production-priority",
        playerId: p.id,
        buildingType: "arms-factory",
        recipeIds,
      });
    expect(set(["make-modern-equipment", "make-modern-equipment"])).toBeNull();
    expect(e.supply.priorities[p.id]["arms-factory"]).toEqual([
      "make-modern-equipment",
    ]);
    expect(set(["refine-steel"])).not.toBeNull();
    expect(set(["unknown"])).not.toBeNull();
    expect(
      m.applyCommand({
        type: "production-priority",
        playerId: 2,
        buildingType: "arms-factory",
        recipeIds: [],
      }),
    ).not.toBeNull();
    expect(e.supply.priorities[p.id]["arms-factory"]).toEqual([
      "make-modern-equipment",
    ]);
    e.progression.states[p.id].completed = [];
    expect(set(["make-modern-equipment"])).not.toBeNull();
    expect(set([])).toBeNull();
    expect(e.supply.priorities[p.id]["arms-factory"]).toEqual([]);
    expect(set(null)).toBeNull();
    expect(e.supply.priorities[p.id]["arms-factory"]).toBeUndefined();
  });
  it("preserves group settings through checkpoints, including empty priority sets", () => {
    const { m, e, p, stock, add, step } = setup();
    add("arms-factory");
    Object.assign(stock, goods);
    expect(
      m.applyCommand({
        type: "production-priority",
        playerId: p.id,
        buildingType: "arms-factory",
        recipeIds: [],
      }),
    ).toBeNull();
    const saved = e.supply.checkpoint();
    e.supply.resetPriorities(p.id);
    step(20);
    expect(Object.values(e.supply.jobs).some(Boolean)).toBe(true);
    e.supply.restore(saved);
    step(20);
    expect(Object.values(e.supply.jobs).some(Boolean)).toBe(false);
    expect(e.supply.priorities[p.id]["arms-factory"]).toEqual([]);
  });
});

it("transports manual priorities through snapshot deltas and preserves a paid batch through producer upgrade", () => {
  const { m, e, p, stock, add, step } = setup(),
    b = add("arms-factory");
  Object.assign(stock, { steel: 12, gunpowder: 10 });
  expect(
    m.applyCommand({
      type: "production-priority",
      playerId: p.id,
      buildingType: "arms-factory",
      recipeIds: ["make-modern-equipment"],
    }),
  ).toBeNull();
  step(20);
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const encoded = decoder.decode(encoder.encode(m.snapshot()));
  expect(
    encoded.expansion!.productionPriorities?.[p.id]["arms-factory"],
  ).toEqual(["make-modern-equipment"]);
  const remaining = e.supply.jobs[b.id]!.remainingTicks;
  m.updateBuilding((b).id, { remainingTicks: 50 });
  step(21);
  expect(e.supply.jobs[b.id]!.remainingTicks).toBe(remaining);
  m.updateBuilding((b).id, { remainingTicks: 0 });
  e.supply.jobs[b.id]!.remainingTicks = 1;
  step(22);
  expect(stock[equipmentItem("Modern")]).toBe(1);
  expect(stock.steel).toBe(0);
  expect(
    m.applyCommand({ type: "reset-production-priorities", playerId: p.id }),
  ).toBeNull();
  const reset = decoder.decode(encoder.encode(m.snapshot()));
  expect(reset.expansion!.productionPriorities?.[p.id]).toBeUndefined();
});
