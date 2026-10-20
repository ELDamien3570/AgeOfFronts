import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TroopCatalogViewModel } from "../../src/skirmish/client/catalog/TroopCatalogViewModel";
import {
  baseReserveIncome,
  cityReserveIncome,
  STARTING_AGE_TROOPS,
} from "../../src/skirmish/content/Economy";
import { UNITS } from "../../src/skirmish/content/Units";

function match() {
  const data = new Uint8Array(80 * 60).fill(133);
  return new Skirmish(new GameMapImpl(80, 60, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
}
describe("opening economy and troop catalogue", () => {
  it("charges gold for every land unit and increases core-line prices across ages", () => {
    expect(UNITS.every((u) => (u.cost.gold ?? 0) > 0)).toBe(true);
    for (const role of ["frontline", "rangedInfantry", "lightCavalry"]) {
      const prices = UNITS.filter((u) => u.troopClass === role).map(
        (u) => u.cost.gold!,
      );
      expect(prices.every((n, i) => i === 0 || n > prices[i - 1])).toBe(true);
    }
  });
  it("keeps a modest three-city Stone economy below twenty total squads after five minutes", () => {
    const potential =
      STARTING_AGE_TROOPS +
      300 * (baseReserveIncome("StoneAge") + 3 * cityReserveIncome("StoneAge"));
    expect(potential / 1000).toBeGreaterThan(10);
    expect(potential / 1000).toBeLessThan(20);
    const game = match(),
      p = game.players[0];
    expect(
      p.reserves +
        game.squads
          .filter((s) => s.playerId === p.id)
          .reduce((n, s) => n + s.troops, 0),
    ).toBe(Math.floor((STARTING_AGE_TROOPS * 12) / 1000) + 36);
    const before = p.reserves;
    expect(
      game.buildings.filter((b) => b.playerId === p.id && b.type === "city"),
    ).toHaveLength(1);
    for (let i = 0; i < 20; i++) game.step();
    expect(p.reserves - before).toBe(
      Math.floor(
        ((baseReserveIncome("StoneAge") + cityReserveIncome("StoneAge")) * 12) /
          1000,
      ),
    );
  });
  it("rejects unaffordable recruitment in both AI choice and the domain without spending reserves", () => {
    const game = match(),
      p = game.players[1];
    p.gold = 59;
    p.reserves = 5000;
    const b = game.addBuilding({
      id: 9999,
      playerId: p.id,
      type: "barracks" as const,
      tile: p.base,
      age: "StoneAge" as const,
      remainingTicks: 0,
    });

    expect(game.expansion!.recruitment(p, "infantry")).toBeUndefined();
    const before = p.reserves;
    expect(
      game.applyCommand({
        type: "recruit",
        playerId: p.id,
        buildingId: b.id,
        definitionId: "stoneage-infantry",
      }),
    ).toMatch(/gold/i);
    expect(p.reserves).toBe(before);
    p.gold = 100;
    expect(game.expansion!.recruitment(p, "infantry")?.unit.id).toBe(
      "stoneage-infantry",
    );
  });
  it("uses combat research and veterancy resolvers and preserves comparisons across filters", () => {
    const vm = new TroopCatalogViewModel();
    expect(vm.cards.length).toBe(UNITS.length);
    const stat = (label: string) =>
      vm.card("stoneage-infantry").stats.find(([name]) => name === label)![1];
    const baseline = Number(stat("Melee damage / soldier"));
    vm.level = 7;
    expect(Number(stat("Melee damage / soldier"))).toBeGreaterThan(baseline);
    for (const u of UNITS.slice(0, 4)) vm.compare(u.id);
    expect(vm.comparison.length).toBe(3);
    vm.search = "does not exist";
    expect(vm.cards).toHaveLength(0);
    expect(vm.comparison).toHaveLength(3);
  });
  it("presents real squad manpower instead of legacy 1,000-troop strength", () => {
    const vm = new TroopCatalogViewModel();
    const stats = (id: string) => new Map(vm.card(id).stats);
    for (const unit of UNITS) {
      const card = stats(unit.id);
      const recipe = unit.formationRecipe!;
      expect(card.get("Squad size")).toBe(
        recipe.model === "soldiers"
          ? `${recipe.capacity} soldiers`
          : "1 vehicle",
      );
      expect(card.get("Reserves")!.split(" ")[0]).toBe(
        String(recipe.reserveCost),
      );
      expect([...card.values()].join(" ")).not.toMatch(/1,?000[- ]troop/);
      if (recipe.model === "soldiers" && unit.rangedAttack)
        expect(card.get("Ranged shots per minute")).toBe(
          String(unit.rangedAttack.rpm),
        );
    }
    const clubmen = UNITS.find(
      (u) => u.id === "stoneage-infantry",
    )!.formationRecipe!;
    vm.upgraded = true;
    const larger = stats("stoneage-infantry");
    expect(larger.get("Squad size")).toBe(
      `${clubmen.enlargedCapacity} soldiers`,
    );
    expect(larger.get("Reserves")!.split(" ")[0]).toBe(
      String(clubmen.enlargedCapacity),
    );
    expect(larger.get("Larger formation")).toContain("Applied");
  });
});
