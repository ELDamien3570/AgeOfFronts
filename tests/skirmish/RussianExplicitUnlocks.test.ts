import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import savedPlan from "../../skirmish/plans/technology-plan.json";
import {
  applyRussianExplicitUnlocks,
  russianBuildingUnlocks,
} from "../../src/skirmish/planning/RussianExplicitUnlocks";
import { createRussianRework } from "../../src/skirmish/planning/RussianTechnologyRework";
import { validatePlan } from "../../src/skirmish/planning/TechnologyPlan";
import { readTechnologyPlan } from "../../src/skirmish/planning/TechnologyPlanMigration";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("Russian explicit planning unlocks", () => {
  for (const source of ["generated", "saved"] as const) {
    it(`${source}: available classes have named research unlocks; Bronze Spearmen require Bronze Equipment`, () => {
      const plan =
        source === "saved"
          ? readTechnologyPlan(savedPlan)
          : createInitialPlan();
      if (source === "generated")
        plan.civilizations.push(createRussianRework(plan.civilizations[1]));
      const civ = plan.civilizations.find((c) => c.id === "russians-rework")!;
      expect(validatePlan(plan)).toEqual([]);
      const troops = civ.units.filter((u) => u.availability === "available");
      expect(troops).toHaveLength(42);
      expect(new Set(troops.map((u) => u.prerequisites[0])).size).toBe(42);
      for (const troop of troops) {
        expect(troop.prerequisites).toHaveLength(1);
        const node = civ.technologies.find(
          (t) => t.id === troop.prerequisites[0],
        )!;
        if (troop.age === "BronzeAge" && troop.role === "antiCavalry") {
          expect(node).toMatchObject({
            id: "bronzeage-bronze-equipment",
            name: "Bronze Equipment",
            age: "BronzeAge",
            kind: "upgrade",
          });
          expect(node.description).toContain("Unlock Bronze Spearmen");
        } else {
          expect(node).toMatchObject({
            name: troop.name,
            age: troop.age,
            kind: "unlock",
          });
        }
      }
      const bronzeSpear = troops.find(
        (u) => u.age === "BronzeAge" && u.role === "antiCavalry",
      )!;
      expect(bronzeSpear.prerequisites).toEqual(["bronzeage-bronze-equipment"]);
      expect(
        civ.technologies.some(
          (t) => t.id === `russian-troop-${bronzeSpear.id}`,
        ),
      ).toBe(false);
      const snapshot = structuredClone(civ);
      applyRussianExplicitUnlocks(civ);
      expect(civ).toEqual(snapshot);
    });
  }
  it("covers every current Russian building art folder with an explicit tier node", () => {
    const plan = readTechnologyPlan(savedPlan);
    const civ = plan.civilizations.find((c) => c.id === "russians-rework")!;
    const catalog = russianBuildingUnlocks(civ);
    for (const age of civ.ages) {
      const folder = `Art/Cultures/Russians/Buildings/${age.id}`;
      for (const entry of readdirSync(folder, { withFileTypes: true }).filter(
        (e) => e.isDirectory() && existsSync(`${folder}/${e.name}/Icon.png`),
      )) {
        const building = catalog.find(
          (b) => b.artFolder === `${age.id}/${entry.name}`,
        );
        expect(building, `${age.id}/${entry.name}`).toBeDefined();
        expect(
          civ.technologies.find((t) => t.id === building!.id),
        ).toMatchObject({ age: age.id, kind: "unlock" });
      }
    }
    for (const b of catalog)
      expect(
        civ.technologies.some(
          (t) => t.id === b.id && t.name === b.name && t.age === b.age,
        ),
      ).toBe(true);
  });
});
