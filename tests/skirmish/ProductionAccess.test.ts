import { describe, expect, it } from "vitest";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { producerCompatible } from "../../src/skirmish/content/Buildings";
import {
  EQUIPMENT_RECIPES,
  equipmentItem,
} from "../../src/skirmish/content/Equipment";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT, UNITS, VESSELS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  DEPOSIT_RESOURCES,
  DEPOSIT_RULES,
} from "../../src/skirmish/domain/DepositGeneration";
import {
  PRODUCTION_RECIPES,
  costRejection,
} from "../../src/skirmish/domain/Supply";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import type { BuildingType } from "../../src/skirmish/Protocol";
import { BUILDING_SPACING } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function match(seed = 47, density: 1 | 2 | 3 | 5 = 1) {
  const map = createSkirmishMap(192, 128, new Uint8Array(192 * 128).fill(133));
  return new Skirmish(map, {
    seed,
    aiCount: 7,
    tribes: true,
    tribeCount: 8,
    runAi: false,
    ruleset: "ages-v1",
    resourceDensity: density,
    resourceOutput: 3,
  });
}
function researchAll(m: Skirmish) {
  for (const player of m.players) {
    player.gold = 1_000_000;
    player.reserves = 100_000;
    m.expansion!.progression.states[player.id].age = "Modern";
    m.expansion!.progression.states[player.id].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
  }
}
describe("production resource accessibility", () => {
  it.each([1, 47, 1987])(
    "covers every regular and tribal camp with reachable, buildable sites for seed %i",
    (seed) => {
      const m = match(seed),
        deposits = m.expansion!.supply.deposits;
      researchAll(m);
      expect(new Set(deposits.map((d) => d.tile)).size).toBe(deposits.length);
      expect(new Set(deposits.map((d) => d.id)).size).toBe(deposits.length);
      for (const player of m.players) {
        const distances = new Map([[player.base, 0]]),
          queue = [player.base];
        for (let head = 0; head < queue.length; head++) {
          const tile = queue[head],
            distance = distances.get(tile)! + 1;
          if (distance > DEPOSIT_RULES.startingReach) continue;
          m.map.forEachNeighbor(tile, (next) => {
            if (
              !distances.has(next) &&
              m.paths.walkable(next) &&
              (!m.owners[next] || m.owners[next] === player.id)
            ) {
              distances.set(next, distance);
              queue.push(next);
            }
          });
        }
        const sites: number[] = [];
        for (const resource of DEPOSIT_RESOURCES) {
          const node = deposits.find(
            (d) =>
              d.resource === resource &&
              distances.has(d.tile) &&
              (resource === "horses" ||
                deposits.every(
                  (other) =>
                    other.resource === "horses" ||
                    other.tile === d.tile ||
                    m.map.euclideanDistSquared(d.tile, other.tile) >=
                      BUILDING_SPACING ** 2,
                )),
          );
          expect(node, `${player.name}: ${resource}`).toBeDefined();
          expect(node!.yieldPerSecond).toBe(
            (resource === "horses" ? 2 : 3) * 3,
          );
          if (resource !== "horses") sites.push(node!.tile);
        }
        for (const tile of sites)
          expect(
            m.map.isLand(tile) && m.paths.connected(player.base, tile),
          ).toBe(true);
      }
    },
  );
  it("is deterministic, scales output, and leaves space for camp construction", () => {
    const m = match(9, 5),
      second = match(9, 5);
    expect(second.expansion!.supply.deposits).toEqual(
      m.expansion!.supply.deposits,
    );
    researchAll(m);
    for (const p of m.players.filter((p) => p.kind === "regular")) {
      expect(m.buildingPlacement(p.id, "factory", p.base, "Modern")).toBeNull();
    }
    const p = m.players[0],
      copper = m.expansion!.supply.deposits.find(
        (d) => d.resource === "copper" && d.owner === p.id,
      )!;
    expect(
      m.buildingPlacement(p.id, "factory", copper.tile, "Modern"),
    ).toContain("extraction");
    expect(m.buildingPlacement(p.id, "mine", copper.tile, "Modern")).toBeNull();
  });
  it("extracts and refines local metals into interchangeable troop equipment and both vehicle components", () => {
    const m = match();
    researchAll(m);
    const e = m.expansion!,
      p = m.players[0],
      stock = e.supply.inventories[p.id];
    const build = (type: BuildingType, tile?: number) => {
      const site = (
        tile === undefined ? m.ownedLandNearest(p.id, p.base, 256) : [tile]
      ).find(
        (t) =>
          m.applyCommand({
            type: "build",
            playerId: p.id,
            buildingType: type,
            tile: t,
            age: "Modern",
          }) === null,
      );
      expect(site, type).toBeDefined();
      const b = m.buildings[m.buildings.length - 1]!;
      // Focus this test on paid production; construction timing is independently covered.
      m.updateBuilding((b).id, { remainingTicks: 0 });
      // Keep this manual single-batch fixture independent of automatic stock balancing.
      if (
        PRODUCTION_RECIPES.some((r) => producerCompatible(b.type, r.building))
      )
        expect(e.supply.setProduction(p, b, null)).toBeNull();
      return b;
    };
    for (const resource of [
      "copper",
      "tin",
      "ironOre",
      "carbon",
      "gunpowder",
      "oil",
    ])
      build(
        resource === "oil" ? "oil-well" : "mine",
        e.supply.deposits.find(
          (d) => d.resource === resource && d.owner === p.id,
        )!.tile,
      );
    const factory = build("factory"),
      arms = build("arms-factory"),
      siege = build("siege-workshop"),
      depot = build("depot");
    e.supply.step(20, m.players, m.buildings, m.owners);
    expect(stock.copper).toBeGreaterThan(0);
    expect(stock.tin).toBeGreaterThan(0);
    expect(stock.ironOre).toBeGreaterThan(0);
    let tick = 20;
    const batch = (recipeId: string, buildingId: number) => {
      const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId)!;
      const [item, amount] = Object.entries(recipe.outputs)[0],
        before = stock[item] ?? 0;
      expect(
        m.applyCommand({
          type: "produce",
          playerId: p.id,
          buildingId,
          recipeId,
        }),
      ).toBeNull();
      e.supply.step(++tick, m.players, m.buildings, m.owners);
      expect(e.supply.jobs[buildingId]).toBeDefined();
      expect(
        m.applyCommand({
          type: "produce",
          playerId: p.id,
          buildingId,
          recipeId: null,
        }),
      ).toBeNull();
      while (e.supply.jobs[buildingId])
        e.supply.step(++tick, m.players, m.buildings, m.owners);
      expect(stock[item]).toBe(before + amount);
    };
    batch("refine-bronze", factory.id);
    batch("refine-bronze", factory.id);
    batch("make-bronzeage-equipment", arms.id);
    const kit = equipmentItem("BronzeAge");
    for (const id of [
      "bronzeage-infantry",
      "bronzeage-archer",
      "bronzeage-cavalry",
    ]) {
      const unit = UNIT.get(id)!;
      expect(unit.equipment).toBe(kit);
      const items = { ...unit.cost.items };
      delete items.horses;
      expect(costRejection(p, stock, { items })).toBeNull();
    }
    batch("refine-iron", factory.id);
    batch("refine-steel", factory.id);
    batch("refine-iron", factory.id);
    batch("refine-steel", factory.id);
    batch("refine-iron", factory.id);
    batch("refine-steel", factory.id);
    batch("make-modern-vehicle-equipment", depot.id);
    batch("refine-iron", factory.id);
    batch("refine-steel", factory.id);
    batch("refine-iron", factory.id);
    batch("refine-steel", factory.id);
    batch("make-modern-siege-equipment", siege.id);
    const tank = UNIT.get("modern-cavalry")!;
    expect(costRejection(p, stock, tank.cost)).toBeNull();
    expect(
      m.applyCommand({
        type: "recruit",
        playerId: p.id,
        buildingId: depot.id,
        definitionId: tank.id,
      }),
    ).toBeNull();
    expect(stock[equipmentItem("Modern", "vehicle")]).toBe(0);
    expect(stock[equipmentItem("Modern", "siege")]).toBe(0);
  });
});
describe("shared equipment contracts", () => {
  it("assigns every siege pattern to workshops, modern vehicles to depots, and troop patterns to their producer tiers", () => {
    for (const [index, age] of AGES.entries()) {
      const siege = EQUIPMENT_RECIPES.find(
        (r) => r.outputs[equipmentItem(age, "siege")],
      )!;
      expect(siege.building).toBe("siege-workshop");
      if (index) {
        const troop = EQUIPMENT_RECIPES.find(
          (r) => r.outputs[equipmentItem(age)],
        )!;
        expect(troop.building).toBe(
          index === 6 ? "arms-factory" : index === 5 ? "armory" : "blacksmith",
        );
        expect(producerCompatible("arms-factory", troop.building)).toBe(true);
      }
    }
    const vehicle = EQUIPMENT_RECIPES.find(
      (r) => r.outputs[equipmentItem("Modern", "vehicle")],
    )!;
    expect(vehicle.building).toBe("depot");
    expect(producerCompatible("arms-factory", vehicle.building)).toBe(false);
  });
  it("defines one troop pattern per equipped age and one siege pattern for every age", () => {
    expect(EQUIPMENT_RECIPES).toHaveLength(14);
    for (const age of AGES) {
      expect(
        EQUIPMENT_RECIPES.filter((r) => r.outputs[equipmentItem(age, "siege")]),
      ).toHaveLength(1);
      for (const unit of UNITS.filter(
        (u) =>
          u.age === age &&
          ["frontline", "ranged", "mounted"].includes(u.role) &&
          !u.tags.includes("vehicle"),
      ))
        expect(unit.equipment).toBe(
          age === "StoneAge" ? undefined : equipmentItem(age),
        );
    }
    for (const unit of UNITS.filter((u) => u.tags.includes("vehicle")))
      expect(unit.cost.items).toEqual({
        [equipmentItem(unit.age, "vehicle")]: 1,
        [equipmentItem(unit.age, "siege")]: 1,
      });
  });
  it("recruits aircraft with gold and time even with no stocks or reserves; ships have no material costs", () => {
    const m = match();
    researchAll(m);
    const p = m.players[0];
    p.reserves = 0;
    m.addBuilding({
      id: m.allocateId(),
      playerId: p.id,
      type: "airstrip",
      tile: p.base,
      age: "Modern",
      remainingTicks: 0,
    });
    const buildingId = m.buildings[m.buildings.length - 1]!.id;
    const quote = new EmpireViewModel(m.snapshot(), {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: buildingId,
    }).aircraft("fighter");
    expect(quote.reason).toBeNull();
    expect(quote.cost).toEqual({ gold: 5000 });
    expect(
      m.applyCommand({
        type: "recruit-aircraft",
        playerId: p.id,
        buildingId,
        definitionId: "fighter",
      }),
    ).toBeNull();
    expect(m.recruitment.jobs[0].cost).toEqual({ gold: 5000 });
    expect(
      VESSELS.every(
        (v) => !Object.keys(v.cost.items ?? {}).length && !v.cost.reserves,
      ),
    ).toBe(true);
    expect(
      PRODUCTION_RECIPES.some((r) =>
        Object.keys(r.outputs).some(
          (id) => id === "equipment:fighter" || id === "equipment:bomber",
        ),
      ),
    ).toBe(false);
  });
});
