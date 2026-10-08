import { describe, expect, it } from "vitest";
import { UNITS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";
import {
  cloneCivilization,
  validatePlan,
} from "../../src/skirmish/planning/TechnologyPlan";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("technology planning documents", () => {
  it("seeds the live baseline and seven ages without assuming new class unlocks", () => {
    const plan = createInitialPlan();
    expect(validatePlan(plan)).toEqual([]);
    const base = plan.civilizations[0];
    for (const age of AGES) {
      expect(base.units.filter((u) => u.age === age)).toHaveLength(6);
      expect(
        base.units.find((u) => u.age === age && u.role === "frontline")!.name,
      ).toBe(UNITS.find((u) => u.age === age && u.line === "infantry")!.name);
      expect(
        base.units.find((u) => u.age === age && u.role === "antiCavalry")!
          .availability,
      ).toBe("undecided");
    }
  });
  it("captures Russian exclusions, Bronze riders and confirmed class starting ages", () => {
    const russian = createInitialPlan().civilizations[1];
    expect(
      russian.units
        .filter((u) => u.age === "StoneAge" && u.availability === "unavailable")
        .map((u) => u.role),
    ).toEqual(["antiCavalry", "heavyCavalry", "rangedCavalry"]);
    expect(
      russian.units.find(
        (u) => u.age === "BronzeAge" && u.role === "lightCavalry",
      )!.name,
    ).toBe("Spear Riders");
    expect(
      russian.units.find(
        (u) => u.age === "BronzeAge" && u.role === "rangedCavalry",
      )!.availability,
    ).toBe("unavailable");
    expect(
      russian.units
        .filter(
          (u) =>
            u.role === "heavyCavalry" &&
            ["StoneAge", "BronzeAge", "ClassicalAge"].includes(u.age),
        )
        .every((u) => u.availability === "unavailable"),
    ).toBe(true);
    expect(
      russian.units
        .filter(
          (u) =>
            u.role === "heavyCavalry" &&
            ["EarlyMedieval", "LateMedieval", "EarlyModern", "Modern"].includes(
              u.age,
            ),
        )
        .every((u) => u.availability === "available"),
    ).toBe(true);
    expect(
      russian.units
        .filter((u) => u.role === "antiCavalry" && u.age !== "StoneAge")
        .every((u) => u.availability === "available"),
    ).toBe(true);
    expect(
      russian.units.find(
        (u) => u.age === "Modern" && u.role === "heavyCavalry",
      )!.availability,
    ).toBe("available");
    expect(russian.technologies.some((t) => /chariot/i.test(t.name))).toBe(
      false,
    );
  });
  it("lets civilizations vary node counts, ordering and branches independently", () => {
    const plan = createInitialPlan();
    const base = plan.civilizations[0],
      russian = plan.civilizations[1];
    russian.technologies[0].name = "Renamed research";
    russian.technologies[0].order = 50;
    russian.technologies.push({
      ...structuredClone(russian.technologies[0]),
      id: "new-cross-branch",
      tree: "warfare",
      prerequisites: [base.technologies[0].id],
    });
    expect(validatePlan(plan)).toEqual([]);
    expect(base.technologies[0].name).not.toBe("Renamed research");
    const copied = cloneCivilization(
      russian,
      "New civilization",
      "new-civilization",
    );
    copied.units[0].name = "Changed";
    expect(russian.units[0].name).not.toBe("Changed");
  });
  it("rejects cycles, dangling links, future-age parents, duplicate IDs and unit slots", () => {
    const plan = createInitialPlan(),
      base = plan.civilizations[0];
    base.technologies[0].prerequisites = [base.technologies[0].id];
    expect(validatePlan(plan).join(" ")).toContain("cycle");
    base.technologies[0].prerequisites = ["missing-node"];
    expect(validatePlan(plan).join(" ")).toContain("missing technology");
    base.technologies[0].prerequisites = [
      base.technologies.find((t) => t.age === "Modern")!.id,
    ];
    expect(validatePlan(plan).join(" ")).toContain("later-age");
    base.units.push(structuredClone(base.units[0]));
    expect(validatePlan(plan).join(" ")).toContain("more than one unit");
    base.technologies.push(structuredClone(base.technologies[1]));
    expect(validatePlan(plan).join(" ")).toContain("duplicate technology ID");
  });
  it("rejects malformed imports without throwing", () => {
    for (const value of [
      null,
      {},
      { schemaVersion: 2, civilizations: [] },
      { schemaVersion: 1, civilizations: [null] },
    ])
      expect(validatePlan(value).length).toBeGreaterThan(0);
    const plan = createInitialPlan();
    (
      plan.civilizations[0].technologies[0] as unknown as {
        prerequisites: unknown;
      }
    ).prerequisites = [null];
    expect(validatePlan(plan).join(" ")).toContain("invalid technology");
  });
});
