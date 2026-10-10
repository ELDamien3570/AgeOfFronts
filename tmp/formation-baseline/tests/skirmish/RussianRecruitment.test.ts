import { describe, expect, it } from "vitest";
import {UNITS} from "../../src/skirmish/content/Units";
import plan from "../../skirmish/plans/technology-plan.json";
import {
  RUSSIAN_RECRUITMENT,
  validateRussianRecruitment,
} from "../../src/skirmish/content/RussianRecruitment";

describe("defined Russian recruitment catalogue readiness", () => {
  it("contains every available authored troop with its exact era and research prerequisite", () => {
    const civ = plan.civilizations.find((c) => c.id === "russians-rus-eight-age-rework")!;
    const available = civ.units.filter((u) => u.availability === "available");
    expect(RUSSIAN_RECRUITMENT.units).toHaveLength(42);
    expect(RUSSIAN_RECRUITMENT.units.map((u) => u.id).sort()).toEqual(
      available.map((u) => u.id).sort(),
    );
    for (const u of available)
      expect(
        RUSSIAN_RECRUITMENT.units.find((r) => r.id === u.id),
      ).toMatchObject({ age: u.age, technologyId: u.prerequisites[0] });
    expect(() => validateRussianRecruitment()).not.toThrow();
  });
  it("every registered support unlock enables an actual recruitable support unit", () => {
    for (const node of RUSSIAN_RECRUITMENT.technologies.filter(t => t.id.startsWith("russian-support-")))
      expect(UNITS.some(u => u.technologyId === node.id && u.age === node.age), node.id).toBe(true);
  });
  it("retains all troop dependencies and excludes unfinished mechanics", () => {
    const nodes = new Map(
      RUSSIAN_RECRUITMENT.technologies.map((t) => [t.id, t]),
    );
    const civ = plan.civilizations.find((c) => c.id === "russians-rus-eight-age-rework")!;
    const visit = (id: string, seen = new Set<string>()) => {
      if (seen.has(id)) return;
      seen.add(id);
      const authored = civ.technologies.find((t) => t.id === id)!;
      const runtime = nodes.get(id)!;
      expect(runtime, id).toBeDefined();
      // Existing naval/economic mechanics remain their currently supported graph.
      if (authored.tree === "warfare") {
        expect(runtime.prerequisites).toEqual(authored.prerequisites);
        authored.prerequisites.forEach((parent) => visit(parent, seen));
      }
    };
    RUSSIAN_RECRUITMENT.units.forEach((u) => visit(u.technologyId));
    expect(
      [...nodes.keys()].filter((id) =>
        /rail-|railway|refinery|warehouse/.test(id),
      ),
    ).toEqual([]);
  });
});
