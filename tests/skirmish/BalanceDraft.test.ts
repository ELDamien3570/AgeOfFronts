import { describe, expect, it } from "vitest";
import {
  createBalanceDraft,
  editRecipe,
  parseBalanceDraft,
  recipeTunings,
} from "../../src/skirmish/client/lab/BalanceDraft";
import {
  BattleLabModel,
  type BattleEntry,
} from "../../src/skirmish/client/lab/BattleLabModel";
import { CONTENT_HASH } from "../../src/skirmish/content/Catalog";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";

const id = "bronzeage-infantry";
const roster = (): BattleEntry[] =>
  ([1, 2] as const).map((side) => ({
    side,
    definitionId: id,
    formations: 1,
    soldiers: side,
    variant: "base",
    shape: "mass",
  }));
const draft = () =>
  createBalanceDraft(
    roster(),
    8,
    editRecipe([], id, {
      hp: 250,
      meleeArmour: 7,
      rangedArmour: 5,
      speedPercent: 120,
      melee: {
        damage: 42,
        rangeTiles: 0.5,
        bonuses: { mounted: 18, infantry: 0 },
      },
    }),
  );

describe("shared Balance Preview drafts", () => {
  it("uses one recipe edit across sides, roster entries and future copies, without changing live content", () => {
    const live = structuredClone(UNIT.get(id)!);
    const state = draft();
    const entries = [
      ...state.scenario.entries,
      { ...roster()[0], formations: 2 },
    ];
    const model = new BattleLabModel(entries, 8, recipeTunings(state.recipes));
    expect(model.game.squads).toHaveLength(4);
    for (const squad of model.game.squads) {
      expect(model.game.unitDefinition(squad)).toMatchObject({
        meleeArmour: 7,
        rangedArmour: 5,
        speedPercent: 120,
        meleeAttack: { damage: 42, bonuses: { mounted: 18, infantry: 0 } },
      });
      expect(squad.manpower?.hp).toBe(250000);
    }
    expect(UNIT.get(id)).toEqual(live);
  });

  it("round trips every editable field and rebuilds the same battle", () => {
    const cavalry = "bronzeage-cavalry";
    let recipes = draft().recipes;
    recipes = editRecipe(recipes, cavalry, {
      chargeBonusSeconds: 8,
      chargeMultiplier: 2.5,
    });
    recipes = editRecipe(recipes, "bronzeage-archer", {
      ranged: {
        damage: 30,
        rpm: 48,
        rangeTiles: 6.5,
        reloadSeconds: 1.25,
        accuracyNear: 95,
        accuracyFar: 35,
        bonuses: { armoured: 14 },
      },
    });
    const source = createBalanceDraft(roster(), 10, recipes);
    const loaded = parseBalanceDraft(JSON.stringify(source));
    expect(loaded).toEqual(source);
    const build = (state: typeof source) =>
      new BattleLabModel(
        state.scenario.entries,
        state.scenario.separation,
        recipeTunings(state.recipes),
      );
    const before = build(source),
      after = build(loaded);
    before.start();
    after.start();
    for (let i = 0; i < 40; i++) {
      before.step();
      after.step();
    }
    expect(after.game.snapshot()).toEqual(before.game.snapshot());
  });

  it("retains removed recipes and original baselines across imports and later edits", () => {
    const source = draft();
    const baseline = structuredClone(source.recipes[0].baseline);
    source.recipes[0].baseContentHash = "previous-content";
    const loaded = parseBalanceDraft(JSON.stringify(source));
    const recipes = editRecipe(loaded.recipes, id, { hp: 300 });
    const exported = createBalanceDraft([], 8, recipes);
    expect(exported.recipes[0]).toMatchObject({
      baseContentHash: "previous-content",
      baseline,
      tuning: { hp: 300 },
    });
    expect(exported.contentHash).toBe(CONTENT_HASH);
    expect(exported.scenario.entries).toEqual([]);
    const restored = editRecipe(recipes, id, {});
    expect(restored).toEqual([]);
    const model = new BattleLabModel(roster(), 8, recipeTunings(restored));
    expect(model.game.unitDefinition(model.game.squads[0])).toEqual(
      UNIT.get(id),
    );
  });

  it("exports valid baseline information for every land recipe", () => {
    for (const unit of UNITS) {
      const recipes = editRecipe([], unit.id, { hp: 250 });
      expect(
        () =>
          parseBalanceDraft(JSON.stringify(createBalanceDraft([], 8, recipes))),
        unit.id,
      ).not.toThrow();
    }
  });

  it.each([
    [
      "schema",
      (value: any) => {
        value.schemaVersion = 99;
      },
    ],
    [
      "unit ID",
      (value: any) => {
        value.recipes[0].definitionId = "missing";
      },
    ],
    [
      "duplicate",
      (value: any) => {
        value.recipes.push(value.recipes[0]);
      },
    ],
    [
      "invalid stat",
      (value: any) => {
        value.recipes[0].tuning.hp = -1;
      },
    ],
    [
      "null stat",
      (value: any) => {
        value.recipes[0].tuning.hp = null;
      },
    ],
    [
      "unknown bonus",
      (value: any) => {
        value.recipes[0].tuning.melee.bonuses.cavalry = 4;
      },
    ],
    [
      "unknown stat",
      (value: any) => {
        value.recipes[0].tuning.defence = 4;
      },
    ],
    [
      "missing weapon",
      (value: any) => {
        value.recipes[0].tuning.ranged = { damage: 4 };
      },
    ],
    [
      "ignored primary weapon",
      (value: any) => {
        value.recipes[0].tuning.attack = { damage: 4 };
      },
    ],
    [
      "over capacity",
      (value: any) => {
        value.scenario.entries[0].soldiers = 100000;
      },
    ],
    [
      "bad formation",
      (value: any) => {
        value.scenario.entries[0].shape = "wedge";
      },
    ],
    [
      "per-row tuning",
      (value: any) => {
        value.scenario.entries[0].tuning = { hp: 2 };
      },
    ],
  ])("rejects %s without mutating the current draft", (_, mutate) => {
    const current = draft();
    const candidate = structuredClone(current);
    mutate(candidate);
    expect(() => parseBalanceDraft(JSON.stringify(candidate))).toThrow();
    expect(current).toEqual(draft());
  });
});
