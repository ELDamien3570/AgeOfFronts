import { describe, expect, it } from "vitest";
import { createRussianRework } from "../../src/skirmish/planning/RussianTechnologyRework";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";
import {
  buildTroopProposals,
  TROOP_STATS,
} from "../../src/skirmish/planning/TroopTreePlan";

const draft = () => createRussianRework(createInitialPlan().civilizations[1]);
describe("Russian troop design proposals", () => {
  it("starts anti-cav in Bronze and heavy cav in Early Medieval, with no excluded troop nodes", () => {
    const rows = buildTroopProposals(draft());
    expect(rows).toHaveLength(42);
    expect(
      rows
        .filter((p) => p.unit.age === "StoneAge")
        .map((p) => p.unit.role)
        .sort(),
    ).toEqual(["frontline", "lightCavalry", "rangedInfantry"]);
    expect(rows.filter((p) => p.unit.role === "antiCavalry")[0].unit.age).toBe(
      "BronzeAge",
    );
    expect(rows.filter((p) => p.unit.role === "heavyCavalry")[0].unit.age).toBe(
      "EarlyMedieval",
    );
    expect(rows.some((p) => /chariot/i.test(p.unit.name))).toBe(false);
    expect(
      rows
        .filter(
          (p) =>
            p.unit.age === "BronzeAge" &&
            ["lightCavalry", "heavyCavalry", "rangedCavalry"].includes(
              p.unit.role,
            ),
        )
        .map((p) => p.unit.name),
    ).toEqual(["Spear Riders"]);
  });
  it("keeps regular infantry cheapest and quickest, heavy cav expensive, and bars bounded", () => {
    const civ = draft(),
      rows = buildTroopProposals(civ);
    for (const age of civ.ages) {
      const units = rows.filter((p) => p.unit.age === age.id),
        base = units.find((p) => p.unit.role === "frontline")!;
      for (const unit of units) {
        expect(unit.gold).toBeGreaterThanOrEqual(base.gold);
        expect(unit.trainingSeconds).toBeGreaterThanOrEqual(
          base.trainingSeconds,
        );
        for (const stat of TROOP_STATS) {
          expect(unit.stats[stat]).toBeGreaterThanOrEqual(0);
          expect(unit.stats[stat]).toBeLessThanOrEqual(100);
        }
      }
      const heavy = units.find((p) => p.unit.role === "heavyCavalry");
      if (heavy) expect(heavy.gold).toBeGreaterThan(base.gold * 6);
    }
    const heavies = rows.filter((p) => p.unit.role === "heavyCavalry"),
      peak = heavies.find((p) => p.unit.age === "LateMedieval")!;
    for (const unit of heavies.filter((p) => p !== peak)) {
      expect(peak.stats.armour).toBeGreaterThan(unit.stats.armour);
      expect(peak.stats.health).toBeGreaterThan(unit.stats.health);
      expect(peak.stats.attack).toBeGreaterThan(unit.stats.attack);
    }
  });
  it("represents the requested counter relationships separately from base power", () => {
    const rows = buildTroopProposals(draft());
    const roles = new Map(rows.map((p) => [p.unit.role, p]));
    expect(roles.get("frontline")!.targetBonus).toBe(1);
    expect(roles.get("antiCavalry")!.counter).toBe("All cavalry classes");
    for (const role of ["rangedInfantry", "rangedCavalry"] as const)
      expect(roles.get(role)!.counter).toBe("Infantry");
    for (const role of ["lightCavalry", "heavyCavalry"] as const)
      expect(roles.get(role)!.counter).toBe("Ranged infantry");
  });
});
