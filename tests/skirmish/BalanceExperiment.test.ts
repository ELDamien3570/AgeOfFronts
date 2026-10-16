import { describe, expect, it } from "vitest";
import {
  createBalanceDraft,
  definitionTuning,
  experimentRecipes,
  parseBalanceDraft,
  recipeTunings,
} from "../../src/skirmish/client/lab/BalanceDraft";
import {
  approvedDefinition,
  editExperiment,
  EXPERIMENT_REVISION,
  experimentDefinition,
  experimentDefinitions,
  newExperiment,
  parseExperiment,
  readExperiment,
  saveExperiment,
} from "../../src/skirmish/client/lab/BalanceExperiment";
import {
  BALANCE_SCENARIOS,
  makeBalanceScenario,
} from "../../src/skirmish/client/lab/BalanceScenarios";
import { BattleLabModel } from "../../src/skirmish/client/lab/BattleLabModel";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import { damageAmount, defenceOf } from "../../src/skirmish/domain/Combat";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { formationApproach } from "../../src/skirmish/domain/FormationContact";
import { remainingHealth } from "../../src/skirmish/domain/Manpower";
import { FIXED, TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import legacyRevision2 from "./fixtures/BalanceRevision2.json";

describe("promoted balance and local preview drafts", () => {
  it("uses the live catalogue as the current approved baseline", () => {
    for (const unit of UNITS) expect(approvedDefinition(unit.id)).toEqual(unit);
  });
  it("continues infantry movement into the modern ages without changing vehicles or support hulls", () => {
    expect(
      ["earlymodern-infantry", "earlymodern-archer", "modern-anticavalry"].map(
        (id) => UNIT.get(id)!.speedPercent,
      ),
    ).toEqual([87, 82, 77]);
    expect(
      ["modern-infantry", "modern-archer", "present-day-anticavalry"].map(
        (id) => UNIT.get(id)!.speedPercent,
      ),
    ).toEqual([88, 83, 78]);
    expect(
      [
        "earlymodern-field-support",
        "modern-field-support",
        "modern-heavycavalry",
        "modern-rangedcavalry",
        "earlymodern-cavalry",
        "present-day-heavycavalry",
      ].map((id) => UNIT.get(id)!.speedPercent),
    ).toEqual([55, 55, 90, 120, 120, 120]);
  });
  it("validates an actual pre-promotion export and retains its edits over current defaults", () => {
    const parsed = parseBalanceDraft(JSON.stringify(legacyRevision2));
    expect(parsed.experiment!.profileRevision).toBe(2);
    expect(
      experimentDefinition(parsed.experiment!, "earlymodern-infantry", 2)
        .speedPercent,
    ).toBe(100);
    expect(
      experimentDefinition(parsed.experiment!, "earlymodern-infantry")
        .speedPercent,
    ).toBe(87);
    expect(
      experimentDefinition(parsed.experiment!, "earlymedieval-heavycavalry")
        .speedPercent,
    ).toBe(108);
  });
  it("implements the approved mainline curve, including Boyar cadence and the ranged counter", () => {
    [
      "stoneage",
      "bronzeage",
      "classicalage",
      "earlymedieval",
      "latemedieval",
    ].forEach((age, i) => {
      const unit = approvedDefinition(`${age}-infantry`);
      expect([
        unit.speedPercent,
        unit.meleeArmour,
        unit.rangedArmour,
        unit.meleeAttack?.damage,
        unit.meleeAttack?.bonuses.infantry,
        unit.meleeAttack?.bonuses.ranged,
        unit.meleeAttack?.rpm,
      ]).toEqual([
        [80, 81, 82, 84, 85][i],
        i * 4,
        i,
        [10, 14, 18, 22, 28][i],
        [10, 14, 18, 22, 28][i],
        [20, 26, 30, 34, 40][i],
        i === 4 ? 50 : 60,
      ]);
    });
    expect(approvedDefinition("stoneage-archer")).toMatchObject({
      speedPercent: 75,
      meleeArmour: 0,
      rangedArmour: 0,
      meleeAttack: { damage: 6, rpm: 60 },
    });
    expect(approvedDefinition("napoleonic-infantry")).toMatchObject({
      speedPercent: 80,
      meleeAttack: { damage: 24, rpm: 40 },
      // C3: 150 HP volleys erased an equal line; 55 HP is the owner default.
      rangedAttack: { damage: 55, rpm: 6 },
    });
    expect(approvedDefinition("napoleonic-archer").speedPercent).toBe(70);
  });
  it("preserves HP, counts, costs, recruitment times, the ram, and modern ages", () => {
    const original = structuredClone(UNITS);
    for (const base of UNITS) {
      const unit = approvedDefinition(base.id);
      expect(unit.formationRecipe).toEqual(base.formationRecipe);
      expect(unit.cost).toEqual(base.cost);
      expect(unit.trainingSeconds).toBe(base.trainingSeconds);
      if (AGES.indexOf(base.age) > 5 || base.formationRecipe?.model === "hull")
        expect(unit).toEqual(base);
    }
    expect(approvedDefinition("stoneage-siege")).toMatchObject({
      meleeArmour: 25,
      rangedArmour: 35,
    });
    expect(UNITS).toEqual(original);
  });
  it("adds class-specific cavalry bonuses on the correct weapon without changing infantry matchups", () => {
    let checked = 0;
    for (const base of UNITS) {
      if (
        base.formationRecipe?.model !== "soldiers" ||
        AGES.indexOf(base.age) > 5
      )
        continue;
      const ratio =
        base.troopClass === "heavyCavalry"
          ? 0.5
          : base.troopClass === "lightCavalry"
            ? 0.25
            : base.troopClass === "rangedCavalry"
              ? 0.1
              : 0;
      if (!ratio) continue;
      const current = approvedDefinition(base.id),
        previous = approvedDefinition(base.id, 1);
      const ranged = base.troopClass === "rangedCavalry";
      const weapon = (ranged ? current.rangedAttack : current.meleeAttack)!;
      const oldWeapon = (
        ranged ? previous.rangedAttack : previous.meleeAttack
      )!;
      expect(weapon.bonuses.mounted, base.id).toBeCloseTo(
        weapon.damage * ratio,
        10,
      );
      expect({
        ...weapon,
        bonuses: { ...weapon.bonuses, mounted: oldWeapon.bonuses.mounted },
      }).toEqual({
        ...oldWeapon,
        bonuses: { ...oldWeapon.bonuses, mounted: oldWeapon.bonuses.mounted },
      });
      expect(damageAmount(weapon, defenceOf(current))).toBeGreaterThan(
        damageAmount(oldWeapon, defenceOf(current)),
      );
      const infantry = approvedDefinition(`${base.age.toLowerCase()}-infantry`);
      expect(damageAmount(weapon, defenceOf(infantry))).toBe(
        damageAmount(oldWeapon, defenceOf(infantry)),
      );
      checked++;
    }
    expect(checked).toBe(13);
    expect(
      approvedDefinition("bronzeage-cavalry").meleeAttack!.bonuses.mounted,
    ).toBe(6.25);
    expect(
      approvedDefinition("earlymedieval-heavycavalry").meleeAttack!.bonuses
        .mounted,
    ).toBe(30);
    expect(
      approvedDefinition("classicalage-rangedcavalry").rangedAttack!.bonuses
        .mounted,
    ).toBe(1.6);
  });
  it("keeps older profile exports and custom stats readable when defaults advance", () => {
    const state = newExperiment();
    state.profileRevision = 1;
    state.changes["earlymedieval-heavycavalry"] = { speedPercent: 108 };
    const setup = makeBalanceScenario("contemporary-EarlyMedieval");
    const exported = createBalanceDraft(
      setup.entries,
      setup.separation,
      experimentRecipes(state),
      state,
    );
    for (const recipe of exported.recipes)
      recipe.tuning = definitionTuning(
        experimentDefinition(state, recipe.definitionId, 1),
      );
    // Exports from before revisions were introduced have no revision field.
    const { profileRevision: _revision, ...unversioned } = state;
    const parsed = parseBalanceDraft(
      JSON.stringify({ ...exported, experiment: unversioned }),
    );
    expect(parsed.experiment!.profileRevision).toBe(1);
    const restored = readExperiment({
      getItem: () => JSON.stringify(unversioned),
    });
    expect(restored.profileRevision).toBe(EXPERIMENT_REVISION);
    expect(restored.changes).toEqual(state.changes);
    const resolved = experimentDefinition(
      parsed.experiment!,
      "earlymedieval-heavycavalry",
    );
    expect(resolved).toMatchObject({
      speedPercent: 108,
      meleeAttack: { bonuses: { mounted: 30 } },
    });
    const fresh = createBalanceDraft(
      parsed.scenario.entries,
      parsed.scenario.separation,
      experimentRecipes(parsed.experiment!),
      parsed.experiment,
    );
    expect(
      parseBalanceDraft(JSON.stringify(fresh)).experiment!.profileRevision,
    ).toBe(EXPERIMENT_REVISION);
    const invalid = { ...state, profileRevision: 999 };
    expect(() => parseExperiment(invalid)).toThrow();
  });
  it("shortens an ordinary heavy-cavalry rank-cycle mirror in the real simulation", () => {
    const id = "earlymedieval-heavycavalry";
    const durations = ([1, 2] as const).map((revision) => {
      const unit = approvedDefinition(id, revision);
      const model = new BattleLabModel(
        ([1, 2] as const).map((side) => ({
          side,
          definitionId: id,
          formations: 1,
          soldiers: 12,
          variant: "base",
          shape: "mass",
        })),
        4,
        {},
        new Map([[id, unit]]),
      );
      model.start();
      while (!model.finished && model.game.tick < 600 * TICKS_PER_SECOND)
        model.step();
      expect(model.finished).toBe(true);
      return model.game.tick;
    });
    expect(durations[1]).toBeLessThan(durations[0]);
  });
  it("round trips shared numeric changes, supports counts and bonuses, and resets against the approved baseline", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const unit = approvedDefinition("bronzeage-infantry");
    unit.speedPercent = 79;
    unit.formationRecipe!.capacity = 20;
    unit.meleeAttack!.bonuses.mounted = 13;
    saveExperiment(storage, editExperiment(newExperiment(), unit));
    const loaded = readExperiment(storage),
      resolved = experimentDefinition(loaded, unit.id);
    expect(resolved).toMatchObject({
      speedPercent: 79,
      formationRecipe: { capacity: 20 },
      meleeAttack: { bonuses: { mounted: 13 } },
    });
    expect(resolved.cost.reserves).toBe(20);
    expect(UNIT.get(unit.id)!.speedPercent).toBe(81);
    expect(editExperiment(loaded, approvedDefinition(unit.id)).changes).toEqual(
      {},
    );
    const malformed = structuredClone(loaded);
    malformed.changes[unit.id]["id.__proto__"] = 1;
    expect(() => parseExperiment(malformed)).toThrow();
  });
  it("round trips experiment exports, deployment, and old schema-1 drafts", () => {
    const unit = approvedDefinition("earlymedieval-infantry");
    unit.speedPercent = 83;
    const state = editExperiment(newExperiment(), unit);
    const scenario = makeBalanceScenario(
      "mixed-ClassicalAge-EarlyMedieval",
      "enlarged",
      true,
      experimentDefinitions(state),
    );
    const source = createBalanceDraft(
      scenario.entries,
      scenario.separation,
      experimentRecipes(state),
      state,
      {
        id: "mixed-ClassicalAge-EarlyMedieval",
        variant: "enlarged",
        includeVehicles: true,
      },
    );
    const loaded = parseBalanceDraft(JSON.stringify(source));
    expect(loaded).toEqual(source);
    const invalidControls = structuredClone(source);
    invalidControls.scenario.controls!.id = "missing-scenario";
    expect(() => parseBalanceDraft(JSON.stringify(invalidControls))).toThrow(
      "scenario controls",
    );
    const model = new BattleLabModel(
      loaded.scenario.entries,
      loaded.scenario.separation,
      recipeTunings(loaded.recipes),
      experimentDefinitions(loaded.experiment!),
    );
    expect(
      model.game.squads
        .filter((s) => s.definitionId === unit.id)
        .every((s) => model.game.unitDefinition(s)?.speedPercent === 83),
    ).toBe(true);
    const legacy = createBalanceDraft([], 8, []);
    legacy.schemaVersion = 1;
    expect(parseBalanceDraft(JSON.stringify(legacy)).schemaVersion).toBe(1);
    const conflict = structuredClone(source);
    conflict.recipes[0].tuning.speedPercent = 999;
    expect(() => parseBalanceDraft(JSON.stringify(conflict))).toThrow(
      "disagree",
    );
  });
  it("builds all 48 scenario/size/vehicle combinations with mirrored armies inside the map", () => {
    const definitions = experimentDefinitions(newExperiment());
    expect(BALANCE_SCENARIOS).toHaveLength(12);
    for (const scenario of BALANCE_SCENARIOS)
      for (const variant of ["base", "enlarged"] as const)
        for (const vehicles of [false, true]) {
          const setup = makeBalanceScenario(
            scenario.id,
            variant,
            vehicles,
            definitions,
          );
          const model = new BattleLabModel(
            setup.entries,
            setup.separation,
            {},
            definitions,
          );
          const blue = model.game.squads.filter((s) => s.playerId === 1),
            red = model.game.squads.filter((s) => s.playerId === 2);
          expect(blue.length, scenario.id).toBeLessThanOrEqual(24);
          expect(blue.map((s) => [s.definitionId, s.troops, s.y])).toEqual(
            red.map((s) => [s.definitionId, s.troops, s.y]),
          );
          expect(
            setup.entries.every(
              (e) =>
                e.soldiers ===
                (variant === "base"
                  ? definitions.get(e.definitionId)!.formationRecipe!.capacity
                  : definitions.get(e.definitionId)!.formationRecipe!
                      .enlargedCapacity),
            ),
          ).toBe(true);
          for (const squad of model.game.squads) {
            expect(squad.x / FIXED).toBeGreaterThan(2);
            expect(squad.x / FIXED).toBeLessThan(94);
            expect(squad.y / FIXED).toBeGreaterThan(2);
            expect(squad.y / FIXED).toBeLessThan(94);
          }
          model.start();
          for (let i = 0; i < 8; i++) model.step();
          expect(model.game.tick).toBe(8);
        }
  });
  it.each(["bronzeage", "classicalage", "earlymedieval", "latemedieval"])(
    "preserves the %s spear/light-cavalry duel target",
    (age) => {
      const definitions = experimentDefinitions(newExperiment());
      const model = new BattleLabModel(
        [`${age}-anticavalry`, `${age}-cavalry`].map((definitionId, i) => ({
          side: (i + 1) as 1 | 2,
          definitionId,
          formations: 1,
          soldiers: 1,
          variant: "base",
          shape: "mass",
        })),
        4,
        {},
        definitions,
      );
      const game = model.game,
        ids = game.squads.map((s) => s.id);
      for (
        ;
        game.tick < 20 * TICKS_PER_SECOND && ids.every((id) => game.squad(id));
        game.tick++
      ) {
        const a = game.squad(ids[0])!,
          b = game.squad(ids[1])!;
        game.updateSquad(a.id, formationApproach(a, b, game.tick, 0));
        game.updateSquad(a.id, { xp: 0 });
        game.updateSquad(b.id, { xp: 0 });
        game.expansion!.battle.fight([]);
        game.expansion!.battle.advanceProjectiles();
      }
      expect(game.squad(ids[1])).toBeUndefined();
      expect(remainingHealth(game.squad(ids[0])!) / 1000).toBe(31);
    },
  );
});
