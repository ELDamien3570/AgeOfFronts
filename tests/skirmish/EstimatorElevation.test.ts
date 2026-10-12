import { describe, expect, it } from "vitest";
import { combatCohorts } from "../../src/skirmish/domain/AiCombatPower";
import { damageAmount, defenceOf } from "../../src/skirmish/domain/Combat";
import { formationModifiers } from "../../src/skirmish/domain/FormationTactics";
import {
  cohortDps,
  engagementEstimate,
} from "../../src/skirmish/domain/TacticalEstimate";
import { sustainedInterval } from "../../src/skirmish/domain/WeaponTiming";
import { hillDefenceScene } from "./fixtures/HillDefence";
describe("elevated combat estimates", () => {
  it.each([10000, 10250, 10500, 11000])(
    "uses live pre-armour damage at %i bp",
    (bp) => {
      const { game, defenders, riders } = hillDefenceScene(true),
        e = game.expansion!,
        own = combatCohorts(e, defenders),
        enemy = combatCohorts(e, riders);
      const a = own[0],
        b = enemy[0],
        facts = formationModifiers(
          b.shape,
          b.deployed,
          a.unit.attack.channel,
          "front",
          false,
        );
      const expected =
        (damageAmount(
          a.unit.attack,
          { ...defenceOf(b.unit), tacticalBp: facts.bp },
          a.contributors,
          a.xp,
          1000,
          undefined,
          bp,
        ) *
          20) /
        sustainedInterval(a.unit.attack);
      expect(cohortDps(own, enemy, { elevationBpA: bp })).toBeCloseTo(
        expected,
        8,
      );
      const estimate = engagementEstimate(own, enemy, {
        elevationBpA: bp,
        elevationBpB: 10000,
      });
      expect(estimate.enemyDps).toBe(cohortDps(enemy, own));
      expect(estimate.ownDps).toBeCloseTo(expected, 8);
    },
  );
});
