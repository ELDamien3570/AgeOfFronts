import { describe, expect, it } from "vitest";
import { createRussianRework } from "../../src/skirmish/planning/RussianTechnologyRework";
import { validatePlan } from "../../src/skirmish/planning/TechnologyPlan";
import { layoutResearch } from "../../src/skirmish/planning/TechnologyPlanGraph";
import { readTechnologyPlan } from "../../src/skirmish/planning/TechnologyPlanMigration";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("Russian eight-age planning rework", () => {
  it("keeps the baseline separate and makes the terminal capstones expensive and aligned", () => {
    const plan = createInitialPlan();
    const source = structuredClone(plan.civilizations[1]);
    const draft = createRussianRework(source);
    plan.civilizations.push(draft);
    expect(source).toEqual(plan.civilizations[1]);
    expect(draft.ages.map((a) => a.id)).toEqual([
      "StoneAge",
      "BronzeAge",
      "ClassicalAge",
      "EarlyMedieval",
      "LateMedieval",
      "Napoleonic",
      "EarlyModern",
      "Modern",
    ]);
    expect(validatePlan(plan)).toEqual([]);
    expect(draft.units).toHaveLength(48);
    expect(
      draft.units.filter(
        (u) => u.age === "StoneAge" && u.availability === "unavailable",
      ),
    ).toHaveLength(3);
    const caps = draft.technologies.filter((t) => t.kind === "capstone");
    expect(caps.map((t) => t.tree).sort()).toEqual([
      "economic",
      "naval",
      "warfare",
    ]);
    const modern = layoutResearch(
      draft.technologies,
      draft.ages.map((a) => a.id),
      3,
    )[7];
    const rows = caps.map((t) => modern.placements.get(t.id)!.row);
    expect(new Set(rows).size).toBe(1);
    for (const cap of caps) {
      expect(cap.age).toBe("Modern");
      expect(cap.gold).toBeGreaterThanOrEqual(1000000);
      expect(
        draft.technologies.some((t) => t.prerequisites.includes(cap.id)),
      ).toBe(false);
    }
    for (const t of draft.technologies.filter(
      (t) => t.age === "Modern" && t.kind !== "capstone",
    ))
      expect(modern.placements.get(t.id)!.row).toBeLessThan(rows[0]);
  });
  it("rejects a capstone becoming an intermediate unlock", () => {
    const plan = createInitialPlan();
    const draft = createRussianRework(plan.civilizations[1]);
    plan.civilizations.push(draft);
    draft.technologies
      .find((t) => t.id === "russian-tank-fire-control")!
      .prerequisites.push("russian-drone-swarms");
    expect(validatePlan(plan).join(" ")).toMatch(/capstone/i);
  });
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
