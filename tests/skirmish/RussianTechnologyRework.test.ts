import { describe, expect, it } from "vitest";
import { createRussianRework } from "../../src/skirmish/planning/RussianTechnologyRework";
import { validatePlan } from "../../src/skirmish/planning/TechnologyPlan";
import { layoutResearch } from "../../src/skirmish/planning/TechnologyPlanGraph";
import { readTechnologyPlan } from "../../src/skirmish/planning/TechnologyPlanMigration";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("Russian eight-age planning rework", () => {
  it("migrates existing version-one edits without changing ages or links", () => {
    const old: any = createInitialPlan();
    old.schemaVersion = 1;
    for (const civ of old.civilizations) {
      delete civ.ages;
      for (const tech of civ.technologies) {
        delete tech.kind;
        delete tech.gold;
        delete tech.researchSeconds;
      }
    }
    old.civilizations[1].technologies[0].name = "Custom retained name";
    const next = readTechnologyPlan(old);
    expect(next.schemaVersion).toBe(2);
    expect(next.civilizations[1].technologies[0].name).toBe(
      "Custom retained name",
    );
    expect(next.civilizations[1].ages).toHaveLength(7);
    expect(
      next.civilizations[1].technologies.map((t) => t.prerequisites),
    ).toEqual(
      old.civilizations[1].technologies.map((t: any) => t.prerequisites),
    );
    expect(validatePlan(next)).toEqual([]);
  });
});
