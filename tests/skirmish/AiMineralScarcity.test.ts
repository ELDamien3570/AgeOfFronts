import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { secondsToTicks, type BuildingType } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { stackLimit } from "../../src/skirmish/Construction";
import { buildingCost } from "../../src/skirmish/content/Buildings";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { infrastructureCapacity } from "../../src/skirmish/domain/AiInfrastructureCapacity";
import { aiResourcePressures } from "../../src/skirmish/domain/AiResourcePressure";
import type { AiProductionDemand } from "../../src/skirmish/domain/AiMilitaryDemand";

function fixture(playerIndex = 1) {
  const terrain = new Uint8Array(96 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47, aiCount: 1, tribes: false, ruleset: "ages-v1", aiEconomy: true, runAi: false,
  });
  const saved = game.checkpoint(); saved.owners.fill(game.players[playerIndex].id); game.restore(saved);
  const player = game.players[playerIndex], expansion = game.expansion!;
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const research = TECHNOLOGIES.filter(t => ["StoneAge", "BronzeAge", "ClassicalAge"].includes(t.age)).map(t => t.id);
  for (const p of game.players) {
    expansion.progression.states[p.id].age = "ClassicalAge";
    expansion.progression.states[p.id].completed = research;
    p.gold = 1e9; p.reserves = 10000;
    for (const id of Object.keys(expansion.supply.inventories[p.id])) expansion.supply.inventories[p.id][id] = 0;
  }
  const tile = game.map.ref(45, 30);
  expansion.supply.replaceDeposits([{ id: 1, owner: player.id, resource: "ironOre", tile, yieldPerSecond: 3 }]);
  const add = (type: BuildingType, tile: number, remainingTicks = 0) => game.addBuilding({ id: game.allocateId(), playerId: player.id, type, tile, age: "ClassicalAge", remainingTicks });
  const snapshot = () => economicSnapshot({ player, tick: game.tick, generation: game.aiGeneration(player.id), age: "ClassicalAge", research,
    inventory: expansion.supply.inventories[player.id], buildings: game.buildingFacts().byOwner(player.id), squads: [], ships: [], jobs: [],
    production: expansion.supply.jobs, cap: 40, threatTroops: 0 });
  const demand: AiProductionDemand = { units: {}, equipment: { "equipment:classicalage": 1000 }, materials: { iron: 12000, ironOre: 12000 } };
  const candidates = (goal = demand) => Array.from({ length: 30 }, () => expansion.economy.placements.candidates(player, snapshot(), goal)).flat().filter(c => c.type === "mine");
  return { game, player, expansion, tile, research, add, snapshot, demand, candidates };
}

describe("capped mineral scarcity capacity", () => {
  it.each([0, 1])("charges rising authoritative construction costs and enforces ten mines for faction %i", index => {
    const f = fixture(index);
    const paid: number[] = [];
    for (let count = 0; count < stackLimit("mine"); count++) {
      const gold = f.player.gold;
      expect(f.game.applyCommand({ type: "build", playerId: f.player.id, buildingType: "mine", tile: f.tile })).toBeNull();
      paid.push(gold - f.player.gold);
      expect(paid[count]).toBe(buildingCost("mine", "ClassicalAge", count).gold);
    }
    expect(paid[paid.length - 1]).toBeGreaterThan(paid[0]);
    const gold = f.player.gold;
    expect(f.game.applyCommand({ type: "build", playerId: f.player.id, buildingType: "mine", tile: f.tile })).toContain("at most 10");
    expect(f.player.gold).toBe(gold);
    for (const b of f.game.buildings) f.game.updateBuilding(b.id, { remainingTicks: 0 });
    const next = f.game.players.find(p => p.id !== f.player.id)!;
    (f.game as unknown as { changeOwner(tile: number, owner: number): void }).changeOwner(f.tile, next.id);
    expect(f.game.buildings.filter(b => b.tile === f.tile && b.playerId === next.id)).toHaveLength(10);
    const checkpoint = f.game.checkpoint(); f.game.restore(checkpoint);
    expect(f.game.buildings.filter(b => b.tile === f.tile && b.playerId === next.id)).toHaveLength(10);
    expect(f.game.applyCommand({ type: "build", playerId: next.id, buildingType: "mine", tile: f.tile })).toContain("at most 10");
  });

  it("uses another useful iron deposit before stacking and preserves that decision across restore", () => {
    const f = fixture();
    f.add("mine", f.tile);
    const free = f.game.map.ref(60, 30);
    f.expansion.supply.addDeposit({ id: 2, owner: f.player.id, resource: "ironOre", tile: free, yieldPerSecond: 3 });
    for (let n = 0; n < 10; n++) { f.add("factory", 100 + n * 5); f.add("blacksmith", 1000 + n * 5); }
    expect(f.candidates().map(c => c.tile)).toContain(free);
    expect(f.candidates().some(c => c.tile === f.tile)).toBe(false);
    const saved = f.game.checkpoint(); f.game.restore(saved);
    expect(f.candidates().some(c => c.tile === f.tile)).toBe(false);
    expect(f.candidates().map(c => c.tile)).toContain(free);
  });

  it("stacks a scarce ore source only for a funded processing deficit and counts paid stacks", () => {
    const f = fixture(); f.add("mine", f.tile);
    f.add("factory", 100); f.add("blacksmith", 1000);
    expect(f.candidates()).toHaveLength(0); // More ore cannot fix one slow refinery/workshop.
    for (let n = 1; n < 10; n++) { f.add("factory", 100 + n * 5); f.add("blacksmith", 1000 + n * 5); }
    expect(f.candidates().some(c => c.tile === f.tile && c.reason === "production-capacity:mine")).toBe(true);
    for (let n = 1; n < 10; n++) f.add("mine", f.tile, secondsToTicks(30));
    expect(f.candidates()).toHaveLength(0);
    f.expansion.supply.inventories[f.player.id].ironOre = 20000;
    expect(f.candidates()).toHaveLength(0);
  });

  it("does not confuse low refined iron with insufficient extraction", () => {
    const f = fixture(); f.add("mine", f.tile); f.add("factory", 100);
    f.expansion.supply.inventories[f.player.id].ironOre = 5000;
    const demand = { units: {}, equipment: {}, materials: { iron: 1200, ironOre: 1200 } };
    expect(infrastructureCapacity(f.snapshot(), demand).workshops.get("factory")).toBeGreaterThan(1);
    expect(f.candidates(demand)).toHaveLength(0);
    expect(aiResourcePressures(f.expansion, f.snapshot(), demand)).toEqual([]);
  });

  it("does not forecast paid stacks as concurrent construction", () => {
    const f = fixture();
    f.add("mine", f.tile);
    f.add("mine", f.tile, secondsToTicks(30));
    f.add("mine", f.tile, secondsToTicks(60));
    const quote = infrastructureCapacity(f.snapshot(), f.demand).extractionQuote("ironOre", f.expansion.supply.resourcesByOwner(f.player.id));
    expect(quote.forecast).toBe(6 * (300 + 270 + 210));
  });

  it("publishes the actual summed extraction rate from completed stacked mines", () => {
    const f = fixture();
    for (let n = 0; n < 3; n++) f.add("mine", f.tile);
    const before = f.expansion.supply.inventories[f.player.id].ironOre;
    for (let tick = 0; tick < secondsToTicks(1); tick++) f.game.step();
    expect(f.expansion.supply.inventories[f.player.id].ironOre - before).toBe(18);
  });

  it("publishes persistent raw input scarcity, credits paid jobs, and clears blocked status after gaining a deposit", () => {
    const f = fixture();
    f.expansion.supply.updateDeposit(1, { yieldPerSecond: .01 });
    for (let n = 0; n < 10; n++) { f.add("mine", f.tile); f.add("factory", 100 + n * 5); f.add("blacksmith", 1000 + n * 5); }
    const first = aiResourcePressures(f.expansion, f.snapshot(), f.demand);
    expect(first[0]).toMatchObject({ resource: "ironOre", blocked: false, inputStarved: true });
    const later = { ...f.snapshot(), tick: secondsToTicks(31) };
    const pressure = aiResourcePressures(f.expansion, later, f.demand, first);
    expect(pressure[0]).toMatchObject({ resource: "ironOre", blocked: true });
    expect(pressure[0].shortage).toBeGreaterThan(0);
    const economic = f.expansion.economy.checkpoint();
    economic.demands = [[f.player.id, { ...f.demand, resourcePressures: pressure }]];
    f.expansion.economy.restore(economic);
    const saved = f.game.checkpoint(); f.game.restore(saved);
    expect(f.expansion.economy.resourcePressures(f.player.id)).toEqual(pressure);
    const factory = f.game.buildings.find(b => b.type === "factory")!;
    f.expansion.supply.jobs[factory.id] = { recipeId: "refine-iron", remainingTicks: secondsToTicks(5), totalTicks: secondsToTicks(10), owner: f.player.id };
    expect(aiResourcePressures(f.expansion, later, f.demand, pressure)[0].paidConsumptionPerSecond).toBe(1);
    const acquired = f.game.map.ref(60, 30);
    f.expansion.supply.addDeposit({ id: 2, owner: f.player.id, resource: "ironOre", tile: acquired, yieldPerSecond: 3 });
    expect(aiResourcePressures(f.expansion, later, f.demand, pressure)[0].blocked).toBe(false);
  });

  it("resumes more than 32 blocked resource sites across decisions and checkpoint restore", () => {
    const f = fixture();
    f.add("factory", 100); f.add("blacksmith", 1000);
    for (let n = 0; n < 33; n++) f.expansion.supply.addDeposit({ id: n + 2, owner: f.player.id, resource: "ironOre", tile: 2000 + n, yieldPerSecond: 3 });
    const legality = vi.spyOn(f.game, "buildingSite").mockReturnValue("Leave a one-cell reserved border around each building");
    const first = aiResourcePressures(f.expansion, f.snapshot(), f.demand);
    expect(legality).toHaveBeenCalledTimes(32);
    expect(first[0]).toMatchObject({ blocked: false, siteCursor: 32, siteScanComplete: false });
    const economic = f.expansion.economy.checkpoint();
    economic.demands = [[f.player.id, { ...f.demand, resourcePressures: first }]];
    f.expansion.economy.restore(economic);
    const checkpoint = f.game.checkpoint(); f.game.restore(checkpoint);
    legality.mockClear();
    const next = aiResourcePressures(f.expansion, { ...f.snapshot(), tick: secondsToTicks(31) }, f.demand, f.expansion.economy.resourcePressures(f.player.id));
    expect(legality).toHaveBeenCalledTimes(2);
    expect(next[0]).toMatchObject({ blocked: true, siteCursor: 0, siteScanComplete: true });
    legality.mockRestore();
  });

  it("recognizes simultaneous copper and tin scarcity without treating missing bronze or research as an extra deposit goal", () => {
    const f = fixture();
    f.expansion.supply.replaceDeposits([]);
    f.add("factory", 100);
    const demand: AiProductionDemand = { units: {}, equipment: { "equipment:bronzeage": 100 }, materials: { bronze: 1200, copper: 960, tin: 240 } };
    const first = aiResourcePressures(f.expansion, f.snapshot(), demand);
    expect(first.map(p => p.resource)).toEqual(["copper", "tin"]);
    expect(first.every(p => p.inputStarved && p.missingInputs?.join(",") === "copper,tin")).toBe(true);
    const mature = aiResourcePressures(f.expansion, { ...f.snapshot(), tick: secondsToTicks(31) }, demand, first);
    expect(mature.every(p => p.blocked)).toBe(true);
    expect(aiResourcePressures(f.expansion, f.snapshot(), { ...demand, bottlenecks: [{ item: "bronze", reason: "research" }] })).toEqual([]);
  });
});
