import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { landTraderTier, logisticsTier, portCargoPercent, vesselEffects } from "../../src/skirmish/domain/ResearchEffects";
import saved from "../../skirmish/plans/technology-plan.json";
import {
  buildingIntegrity,
  buildingTechnology,
} from "../../src/skirmish/content/Buildings";
import { cityReserveIncome } from "../../src/skirmish/content/Economy";
import {
  TECHNOLOGIES,
  validateTechnologies,
} from "../../src/skirmish/content/Technology";
import { VESSELS } from "../../src/skirmish/content/Units";
import { AutomaticBuildingTiers } from "../../src/skirmish/domain/AutomaticBuildingTiers";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  advanceRejection,
  startingProgression,
} from "../../src/skirmish/domain/Progression";
import { TradeReceiving } from "../../src/skirmish/domain/TradeReceiving";
import type { Building, Player } from "../../src/skirmish/Protocol";
const civ = saved.civilizations.find(
  (c) => c.id === "russians-rus-eight-age-rework",
)!;
describe("approved Rus runtime tree", () => {
  it("matches every saved prerequisite and includes no obsolete research tolls", () => {
    expect(TECHNOLOGIES.map((t) => t.id)).toEqual(
      civ.technologies.map((t) => t.id),
    );
    for (const t of TECHNOLOGIES)
      expect(t.prerequisites).toEqual(
        civ.technologies.find((n) => n.id === t.id)!.prerequisites,
      );
    expect(() => validateTechnologies()).not.toThrow();
  });
  it("starts with city construction and keeps the city statistical upgrade unresearched", () => {
    const state = startingProgression();
    expect(state.completed).toContain(buildingTechnology("city", "StoneAge"));
    expect(state.completed).not.toContain("rus-stoneage-cities");
    expect(cityReserveIncome("StoneAge", state.completed)).toBe(8);
    const complete = [...state.completed, "rus-stoneage-cities"];
    expect(cityReserveIncome("StoneAge", complete)).toBe(9);
    expect(buildingIntegrity("city", "StoneAge", complete)).toBe(1320);
  });
  it("applies same-age city health upgrades once and preserves damaged health ratios", () => {
    const state = startingProgression();
    state.completed.push("rus-stoneage-cities");
    let city: Building = {
      id: 1,
      playerId: 1,
      type: "city",
      age: "StoneAge",
      tile: 0,
      remainingTicks: 0,
      health: 600,
      maxHealth: 1200,
    };
    const tiers = new AutomaticBuildingTiers(),
      facts = { producerRevision: 1, byOwner: () => [city] };
    const update = (_id: number, patch: Partial<Building>) => {
      city = { ...city, ...patch };
    };
    tiers.step(
      [{ id: 1, eliminated: false } as Player],
      { 1: state },
      facts as any,
      update,
    );
    expect(city.maxHealth).toBe(1320);
    expect(city.health).toBe(660);
    tiers.step(
      [{ id: 1, eliminated: false } as Player],
      { 1: state },
      facts as any,
      update,
    );
    expect(city.health).toBe(660);
  });
  it("still requires two complete current-age branches including side branches", () => {
    const state = startingProgression("EarlyModern");
    state.completed = TECHNOLOGIES.filter(
      (t) =>
        AGES.indexOf(t.age) < AGES.indexOf("EarlyModern") ||
        (t.age === "EarlyModern" &&
          (t.tree === "naval" || t.tree === "economic")),
    ).map((t) => t.id);
    expect(advanceRejection(state, 1000000)).toBeNull();
    state.completed = state.completed.filter(
      (id) => id !== "rus-earlymodern-submarines",
    );
    expect(advanceRejection(state, 1000000)).toBe(
      "Complete any two current-age trees",
    );
  });
  it("registers submarine tiers as normal warships and keeps all ages reachable", () => {
    expect(
      VESSELS.filter((v) => v.id.endsWith("-submarine")).map((v) => [
        v.kind,
        v.age,
      ]),
    ).toEqual([
      ["warship", "EarlyModern"],
      ["warship", "Modern"],
    ]);
    for (const age of AGES)
      for (const t of TECHNOLOGIES.filter((t) => t.age === age))
        expect(
          t.prerequisites.every((id) =>
            TECHNOLOGIES.some(
              (p) => p.id === id && AGES.indexOf(p.age) <= AGES.indexOf(age),
            ),
          ),
        ).toBe(true);
  });
  it("quotes construction within the player age and rejects buying an obsolete automatic tier", () => {
    const data = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(new GameMapImpl(64,64,data,data.length), {seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});
    const state = game.expansion!.progression.states[1];
    state.age = "EarlyModern";
    state.completed = TECHNOLOGIES.filter(t => AGES.indexOf(t.age) <= 6).map(t => t.id);
    const vm = new EmpireViewModel(game.snapshot(), {selected:new Set(),selectedShips:new Set(),selectedBuilding:null});
    expect(vm.buildingAge("nuclear-facility")).toBe("EarlyModern");
    expect(game.expansion!.buildRejection(game.players[0], "barracks", game.players[0].base, "StoneAge")).toContain("latest researched tier");
  });
  it("separates road and trader upgrades and improves existing submarines with Modern fleet research", () => {
    const roads = ["rus-modern-roads"];
    expect(logisticsTier(roads)).toBe(7);
    expect(landTraderTier(roads)).toBe(0);
    expect(landTraderTier(["rus-classicalage-land-traders"])).toBe(2);
    expect(portCargoPercent(["rus-bronzeage-ports", "rus-modern-ports"])).toBe(135);
    const sub = VESSELS.find(v => v.id === "earlymodern-submarine")!;
    expect(vesselEffects(sub, ["rus-modern-ship-improvements"]).health).toBe(Math.round(sub.health * 1.1));
    const trader = VESSELS.find(v => v.age === "StoneAge" && v.kind === "trade")!;
    expect(vesselEffects(trader, ["rus-stoneage-coastal-navigation"])).toBe(trader);
  });
  it("persists receiving improvements without changing stack counts", () => {
    const r = new TradeReceiving();
    r.configure("1:1", 1, 0);
    const baseline = r.available("1:1", 0, false, false, false);
    r.configure("1:1", 1, 0, 110);
    expect(r.available("1:1", 0, false, false, false)).toBe(
      Math.round(baseline * 1.1),
    );
    const restored = new TradeReceiving();
    restored.restore(r.checkpoint());
    expect(restored.status("1:1", 0)).toEqual(r.status("1:1", 0));
  });
});
