import { describe, expect, it } from "vitest";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { generateDeposits } from "../../src/skirmish/domain/DepositGeneration";
import { PRODUCTION_RECIPES } from "../../src/skirmish/domain/Supply";
import { Skirmish } from "../../src/skirmish/Simulation";

function world() {
  const width = 600, height = 300;
  const terrain = new Uint8Array(width * height), desert = new Uint8Array(terrain.length);
  for (let tile = 0; tile < terrain.length; tile++) {
    const x = tile % width;
    terrain[tile] = x < 150 ? 153 : x < 300 ? 143 : 133;
    desert[tile] = x >= 450 ? 1 : 0;
  }
  return createSkirmishMap(width, height, terrain, undefined, undefined, { desert });
}
describe("seeded terrain-weighted deposits", () => {
  it("reproduces layouts, changes them with the match seed, and avoids duplicate tiles", () => {
    const map = world(), first = generateDeposits(map, 44);
    expect(generateDeposits(map, 44)).toEqual(first);
    expect(generateDeposits(map, 45)).not.toEqual(first);
    expect(new Set(first.map(d => d.tile)).size).toBe(first.length);
    expect(first.some(d => d.resource === "nitrate" || d.resource === "sulphur")).toBe(false);
  });
  it("doubles ordinary abundance, makes powder plentiful, and favors the requested environments", () => {
    const map = world();
    const deposits = Array.from({ length: 20 }, (_, i) => generateDeposits(map, i * 1987 + 3)).flat();
    const count = (resource: string, min = 0, max = 600) =>
      deposits.filter(d => d.resource === resource && d.tile % 600 >= min && d.tile % 600 < max).length;
    const expected = 20 * 600 * 300 * 2 / 6300;
    for (const resource of ["stone", "copper", "tin", "ironOre", "carbon", "horses", "oil"])
      expect(count(resource) / expected).toBeGreaterThan(.85);
    expect(count("stone") / expected).toBeLessThan(1.15);
    expect(count("gunpowder") / expected).toBeGreaterThan(1.75);
    for (const resource of ["copper", "tin", "ironOre"])
      expect(count(resource, 0, 150) / count(resource, 300, 450)).toBeGreaterThan(2.4);
    expect(count("oil", 450, 600) / count("oil", 300, 450)).toBeGreaterThan(3);
    expect(count("horses", 300, 450) / count("horses", 150, 300)).toBeGreaterThan(2.4);
    for (let x = 0; x < 600; x += 150) expect(count("gunpowder", x, x + 150)).toBeGreaterThan(200);
  });
  it("respects density and output settings and copies the supplied biome mask", () => {
    const map = world(), normal = generateDeposits(map, 57);
    const dense = generateDeposits(map, 57, 2, 3);
    expect(dense.length / normal.length).toBeGreaterThan(1.7);
    expect(dense.length / normal.length).toBeLessThan(2.3);
    expect(dense.every(d => d.yieldPerSecond === (d.resource === "horses" ? 6 : 9))).toBe(true);
    const desert = new Uint8Array(100);
    const small = createSkirmishMap(10, 10, new Uint8Array(100).fill(133), undefined, undefined, { desert });
    const before = generateDeposits(small, 7); desert.fill(1);
    expect(generateDeposits(small, 7)).toEqual(before);
    const fallback = generateDeposits(small, 8);
    expect(new Set(fallback.map(d => d.tile)).size).toBe(fallback.length);
  });
  it("only places oil on water and excludes impassable ground", () => {
    const data = new Uint8Array(40000).fill(5);
    data.fill(159, 10000, 20000); data.fill(133, 20000);
    const map = createSkirmishMap(200, 200, data);
    for (const d of generateDeposits(map, 18)) {
      expect(map.isImpassable(d.tile)).toBe(false);
      if (map.isWater(d.tile)) expect(d.resource).toBe("oil");
    }
  });
  it("extracts gunpowder directly only after Powder Milling and has no refining recipe", () => {
    const map = createSkirmishMap(96, 64, new Uint8Array(96 * 64).fill(133));
    const match = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
    const expansion = match.expansion!, deposit = expansion.supply.deposits.find(d => d.resource === "gunpowder")!;
    match.owners[deposit.tile] = 1;
    match.addBuilding({ id: match.allocateId(), type: "mine", tile: deposit.tile, playerId: 1, remainingTicks: 0, age: "LateMedieval" });

    expansion.progression.states[1].age = "LateMedieval";
    expansion.supply.step(20, match.players, match.buildings, match.owners);
    expect(expansion.supply.inventories[1].gunpowder).toBe(0);
    expansion.progression.states[1].completed.push("rus-latemedieval-factories-mines");
    expansion.supply.step(40, match.players, match.buildings, match.owners);
    expect(expansion.supply.inventories[1].gunpowder).toBeGreaterThan(0);
    expect(PRODUCTION_RECIPES.some(r => r.id === "refine-gunpowder")).toBe(false);
  });
});
