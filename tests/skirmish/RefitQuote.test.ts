// Balance row "Refits" (05 issue 8 / rec 5; 20 N10): a refit costs at least
// REFIT_FLOOR_PERCENT of the recruit-gold gap between source and target.
import { describe, expect, it } from "vitest";
import english from "../../resources/lang/en.json";
import { serverText } from "../../src/skirmish/client/ServerText";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT, VESSEL } from "../../src/skirmish/content/Units";
import {
  affordableRefitCount,
  affordableRefitPrefix,
  quoteShipRefits,
  sumCosts,
  VESSEL_REFIT_PORT_MESSAGE,
  vesselRefitCost,
} from "../../src/skirmish/domain/RefitQuote";
import { REFIT_FLOOR_PERCENT, refitFloorGold, unitRefitCost } from "../../src/skirmish/domain/Refitting";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

const vessel = (id: string) => VESSEL.get(id)!;

describe("refit price floor", () => {
  it("uses the owner-decision floor (OD-8)", () => {
    expect(REFIT_FLOOR_PERCENT).toBe(60);
    expect(refitFloorGold(5600, 700)).toBe(2940);
    expect(refitFloorGold(700, 5600)).toBe(0);
  });
  it("prices a Stone warship's Modern refit at the floor, 65% of a new hull with the old one", () => {
    const stone = vessel("stoneage-warship"), modern = vessel("modern-warship");
    expect([stone.cost.gold, modern.cost.gold]).toEqual([700, 5600]);
    expect(vesselRefitCost(modern, null).gold).toBe(2600);
    expect(vesselRefitCost(modern, stone).gold).toBe(2940);
    expect(vesselRefitCost(modern, stone, 3).gold).toBe(3 * 2940);
    expect(Math.round(100 * (700 + 2940) / 5600)).toBe(65);
  });
  it("keeps the per-age formula where it is dearer than the floor", () => {
    expect(vesselRefitCost(vessel("modern-warship"), vessel("bronzeage-warship")).gold).toBe(2600);
    for (const [source, target] of [["stoneage-infantry", "modern-infantry"], ["stoneage-cavalry", "napoleonic-cavalry"]]) {
      const t = UNIT.get(target)!, s = UNIT.get(source)!;
      expect(unitRefitCost(t, s)).toEqual(unitRefitCost(t, null));
      expect(unitRefitCost(t, s, 1, "enlarged")).toEqual(unitRefitCost(t, null, 1, "enlarged"));
    }
  });
  it("counts the affordable prefix of a mixed-tier selection", () => {
    const modern = vessel("modern-warship");
    const costs = [vesselRefitCost(modern, vessel("stoneage-warship")), vesselRefitCost(modern, vessel("bronzeage-warship"))];
    expect(affordableRefitPrefix(costs, 2939, {})).toBe(0);
    expect(affordableRefitPrefix(costs, 2940 + 2599, {})).toBe(1);
    expect(affordableRefitPrefix(costs, 5540, {})).toBe(2);
    expect(sumCosts(costs).gold).toBe(5540);
    // The homogeneous helper agrees with the prefix on equal costs.
    expect(affordableRefitCount(costs[0], 2 * 2940, {}, 3)).toBe(affordableRefitPrefix([costs[0], costs[0], costs[0]], 2 * 2940, {}));
  });
});

function fleet() {
  const data = new Uint8Array(96 * 64).fill(133);
  for (let y = 20; y < 40; y++) for (let x = 0; x < 96; x++) data[y * 96 + x] = 0;
  const m = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  for (const p of m.players) {
    const state = m.expansion!.progression.states[p.id];
    state.age = "Modern";
    state.completed = TECHNOLOGIES.filter(t => !t.optional).map(t => t.id);
  }
  const add = (x: number, definitionId: string): Ship => m.addShip({
    id: m.allocateId(), playerId: 1, kind: "warship", definitionId,
    x: (x + 0.5) * FIXED, y: 30.5 * FIXED, health: 100, destination: null,
    waypoints: [], path: [], nextPathIndex: 0, fighting: false,
  });
  const target = vessel("modern-warship");
  m.expansion!.supply.inventories[1] = { ...vesselRefitCost(target, null, 4).items };
  // 05 rec 5: a vessel refit needs an owned port of the target's age.
  const port = m.addBuilding({ id: m.allocateId(), playerId: 1, type: "port", tile: m.map.ref(10, 19),
    remainingTicks: 0, health: 1000, maxHealth: 1000, age: "Modern" });
  return { m, add, target, player: m.players[0], port };
}

describe("refit-ships command charges each hull from its own tier", () => {
  it("charges the floor for a Stone hull and the formula for a Bronze hull", () => {
    const { m, add, target, player } = fleet();
    const stone = add(10, "stoneage-warship"), bronze = add(11, "bronzeage-warship");
    player.gold = 10_000;
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id, bronze.id], definitionId: target.id })).toBeNull();
    expect(player.gold).toBe(10_000 - 2940 - 2600);
    expect(stone.refit?.targetId).toBe(target.id);
    expect(bronze.refit?.targetId).toBe(target.id);
  });
  it("refits only the affordable prefix and rejects an unaffordable fleet without side effects", () => {
    const { m, add, target, player } = fleet();
    const stone = add(10, "stoneage-warship"), bronze = add(11, "bronzeage-warship");
    player.gold = 2939;
    const items = { ...m.expansion!.supply.inventories[1] };
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id, bronze.id], definitionId: target.id }))
      .toMatch(/gold/i);
    expect(player.gold).toBe(2939);
    expect(m.expansion!.supply.inventories[1]).toEqual(items);
    expect(stone.refit ?? null).toBeNull();
    player.gold = 2940 + 2599;
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id, bronze.id], definitionId: target.id })).toBeNull();
    expect(player.gold).toBe(2599);
    expect(stone.refit?.targetId).toBe(target.id);
    expect(bronze.refit ?? null).toBeNull();
  });
  it("quotes the same price the command charges", () => {
    const { m, add, target, player } = fleet();
    const stone = add(10, "stoneage-warship");
    player.gold = 10_000;
    const quote = quoteShipRefits([stone], undefined, {
      player, research: [target.technologyId], inventory: m.expansion!.supply.inventories[1],
    })!;
    expect(quote.target?.id).toBe(target.id);
    expect(quote.cost?.gold).toBe(2940);
  });
});

describe("vessel refits need a port of the target's age (05 rec 5)", () => {
  it("rejects a refit without such a port, with no side effects, and accepts it once the port is upgraded", () => {
    const { m, add, target, player, port } = fleet();
    const stone = add(10, "stoneage-warship");
    player.gold = 10_000;
    m.updateBuilding(port.id, { age: "Napoleonic" });
    const items = { ...m.expansion!.supply.inventories[1] };
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id], definitionId: target.id })).toBe(VESSEL_REFIT_PORT_MESSAGE);
    expect(player.gold).toBe(10_000);
    expect(m.expansion!.supply.inventories[1]).toEqual(items);
    expect(stone.refit ?? null).toBeNull();
    m.updateBuilding(port.id, { remainingTicks: 5, age: "Modern" });
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id], definitionId: target.id })).toBe(VESSEL_REFIT_PORT_MESSAGE);
    m.updateBuilding(port.id, { remainingTicks: 0 });
    expect(m.applyCommand({ type: "refit-ships", playerId: 1, shipIds: [stone.id], definitionId: target.id })).toBeNull();
    expect(stone.refit?.targetId).toBe(target.id);
  });
  it("shows the rejection translated", () => {
    expect(serverText(VESSEL_REFIT_PORT_MESSAGE)).toBe(english.skirmish_server.vessel_refit_port);
  });
});
