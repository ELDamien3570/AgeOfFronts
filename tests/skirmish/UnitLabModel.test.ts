import { describe, expect, it } from "vitest";
import {
  draftRecruitmentCost,
  estimatedDps,
  LAB_ENTITIES,
  makeDraft,
  validateDraft,
  type DpsTarget,
} from "../../src/skirmish/client/lab/UnitLabModel";
import { UNIT } from "../../src/skirmish/content/Units";
import type { UnitDefinition } from "../../src/skirmish/domain/Definitions";
import {
  createFormation,
  formationDoctrine,
  formationSlots,
} from "../../src/skirmish/domain/FormationGeometry";
const target: DpsTarget = {
  tag: "ship",
  armourKind: "points",
  meleeArmour: 0,
  rangedArmour: 0,
  healthPercent: 100,
  accuracy: 100,
  cover: 0,
  soldiers: false,
};
describe("unit lab estimates and draft isolation", () => {
  it("derives mounted reserves and horses from both recipe sizes, including after JSON edits", () => {
    const draft = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "unit:stoneage-cavalry")!,
    );
    const unit = draft.definition as unknown as UnitDefinition;
    unit.formationRecipe!.capacity = 5;
    unit.formationRecipe!.enlargedCapacity = 9;
    unit.cost.reserves = 999;
    unit.cost.items = { ...unit.cost.items, horses: 999 };
    unit.formationRecipe!.reserveCost = 999;
    validateDraft(draft.definition);
    expect(draftRecruitmentCost(draft, "base")).toMatchObject({
      reserves: 5,
      items: { horses: 5 },
    });
    expect(draftRecruitmentCost(draft, "enlarged")).toMatchObject({
      reserves: 9,
      items: { horses: 9 },
    });
    const foot = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "unit:stoneage-infantry")!,
    );
    const definition = foot.definition as unknown as UnitDefinition;
    definition.cost.items = { ...definition.cost.items, horses: 77 };
    validateDraft(foot.definition);
    expect(draftRecruitmentCost(foot, "base")!.items?.horses).toBeUndefined();
    expect(UNIT.get("stoneage-cavalry")!.formationRecipe!.capacity).toBe(4);
  });
  it("keeps aggregate naval damage normalized and applies hypothetical accuracy", () => {
    const draft = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "vessel:stoneage-warship")!,
    );
    expect(estimatedDps(draft, target, "base", "mass")[0].dps).toBe(80);
    expect(
      estimatedDps(draft, { ...target, accuracy: 50 }, "base", "mass")[0].dps,
    ).toBe(40);
    expect(
      estimatedDps(draft, { ...target, tag: "aircraft" }, "base", "mass")[0]
        .dps,
    ).toBe(0);
  });
  it("applies point armour and does not turn payload one-tick timing into sortie DPS", () => {
    const draft = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "vessel:stoneage-warship")!,
    );
    expect(
      estimatedDps(draft, { ...target, rangedArmour: 60 }, "base", "mass")[0]
        .dps,
    ).toBe(50);
    const bomber = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "aircraft:earlymodern-bomber")!,
    );
    expect(estimatedDps(bomber, target, "base", "mass")[0].cycleSeconds).toBe(
      120,
    );
  });
  it("edits soldier recipes without mutating live units and updates eligible contributors", () => {
    const draft = makeDraft(
      LAB_ENTITIES.find((e) => e.key === "unit:stoneage-archer")!,
    );
    const original = UNIT.get("stoneage-archer")!;
    const definition = draft.definition as unknown as UnitDefinition;
    definition.formationRecipe!.capacity = 20;
    definition.formationRecipe!.enlargedCapacity = 40;
    const infantry = { ...target, tag: "infantry" as const, soldiers: true };
    const base = estimatedDps(draft, infantry, "base", "line").find(
      (p) => p.channel === "ranged",
    )!;
    const enlarged = estimatedDps(draft, infantry, "enlarged", "line").find(
      (p) => p.channel === "ranged",
    )!;
    expect(enlarged.dps).toBeCloseTo(base.dps * 2);
    expect(
      estimatedDps(draft, infantry, "base", "column").find(
        (p) => p.channel === "ranged",
      )!.contributors,
    ).toBeLessThan(base.contributors);
    expect(original.formationRecipe!.capacity).toBe(12);
    expect(() => validateDraft(draft.definition)).not.toThrow();
    definition.formationRecipe!.enlargedCapacity = 10;
    expect(() => validateDraft(draft.definition)).toThrow();
  });
  it("lets a local doctrine preview change formation access without contaminating cached live slots", () => {
    const id = "stoneage-cavalry",
      formation = { ...createFormation(id), shape: "line" as const };
    const squad = {
      id: 1,
      definitionId: id,
      kind: "cavalry" as const,
      troops: 6,
      formation,
    };
    const live = formationSlots(squad, 0);
    const doctrine = {
      ...formationDoctrine(id),
      spacing: 500,
      shapes: ["line" as const],
    };
    expect(formationSlots(squad, 0, doctrine)).not.toEqual(live);
    expect(formationSlots(squad, 0)).toBe(live);
  });
});
