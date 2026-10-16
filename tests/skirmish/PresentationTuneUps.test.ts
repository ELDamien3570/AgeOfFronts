import { finishRangedPreparation } from "./fixtures/RangedPreparation";
import { describe, expect, it } from "vitest";
import {
  formationRenderPose,
  strategicFormationBox,
  strategicFormationContains,
} from "../../src/skirmish/client/FormationRenderPose";
import { RUSSIAN_RECRUITMENT } from "../../src/skirmish/content/RussianRecruitment";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { attackContributors,damageAmount,defenceOf } from '../../src/skirmish/domain/Combat';
import { tacticalDefence } from '../../src/skirmish/domain/FormationTactics';
import { contactParticipants } from '../../src/skirmish/domain/FormationContact';
import { weaponAccuracy } from '../../src/skirmish/domain/WeaponAccuracy';
import {
  createFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import {
  commitWeaponShot,
  validateWeaponState,
} from "../../src/skirmish/domain/WeaponTiming";
import { hybridCombatScene } from "./fixtures/HybridCombat";

describe("presentation tune ups", () => {
  it("halves mounted recipe times and preserves infantry times", () => {
    for (const u of RUSSIAN_RECRUITMENT.units) {
      if (u.troopClass === "lightCavalry") expect(u.trainingSeconds).toBe(15);
      if (u.troopClass === "rangedCavalry") expect(u.trainingSeconds).toBe(20);
      if (u.troopClass === "heavyCavalry")
        expect(u.trainingSeconds).toBe(u.age === "LateMedieval" ? 35 : 30);
      if (u.troopClass === "frontline") expect(u.trainingSeconds).toBe(12);
    }
  });
  it("requires both second tier branches in each age", () => {
    for (const t of TECHNOLOGIES.filter((t) =>
      t.id.startsWith("formation-capacity-"),
    )) {
      expect(t.prerequisites).toEqual([
        `rus-${t.age.toLowerCase()}-ranged`,
        `rus-${t.age.toLowerCase()}-mobile`,
      ]);
    }
  });
  it("anchors tight polygon bounds and keeps oriented strategic pads selectable", () => {
    const { grenadiers } = hybridCombatScene();
    for (const shape of ["line", "column", "square"] as const)
      for (const facing of [0, TURN / 8, TURN / 4]) {
        const pose = formationRenderPose(
          {
            ...grenadiers,
            formation: {
              ...createFormation(grenadiers.definitionId),
              shape,
              facing,
            },
          },
          0,
        );
        const points = pose.footprints.flat();
        expect(pose.bounds.bottom).toBe(Math.max(...points.map((p) => p.y)));
        expect(pose.bounds.left).toBe(Math.min(...points.map((p) => p.x)));
        const box = strategicFormationBox(pose, 8);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(strategicFormationContains(box, box, 8)).toBe(true);
        const x = (box.width / 2 / 8) * 0.99,
          y = (box.height / 2 / 8) * 0.99,
          c = Math.cos(box.angle),
          s = Math.sin(box.angle);
        expect(
          strategicFormationContains(
            box,
            { x: box.x + x * c - y * s, y: box.y + x * s + y * c },
            8,
          ),
        ).toBe(true);
      }
  });
  it("lets hybrid channels commit simultaneously without changing ranged reload deadlines", () => {
    const u = UNIT.get("napoleonic-infantry")!;
    const state = commitWeaponShot(u.rangedAttack!, undefined, 0, false, true)!;
    const melee = commitWeaponShot(u.meleeAttack!, state, 0, false, true)!;
    expect(melee.ranged).toEqual(state.ranged);
    validateWeaponState(melee);
    expect(
      commitWeaponShot(
        u.rangedAttack!,
        melee,
        state.ranged!.nextTick - 1,
        false,
        true,
      ),
    ).toBeUndefined();
    expect(
      commitWeaponShot(
        u.rangedAttack!,
        melee,
        state.ranged!.nextTick,
        false,
        true,
      ),
    ).toBeDefined();
  });
  it("defends contacting enemies while firing at the explicit rear target", () => {
    const { game, grenadiers, contact, rear } = hybridCombatScene();
    game.expansion!.battle.fight([]);
    expect(game.volleys.some(v=>v.squadId===grenadiers.id&&v.melee&&v.targetId===contact.id)).toBe(true);
    expect(game.volleys.some(v=>v.squadId===grenadiers.id&&!v.melee)).toBe(false);
    finishRangedPreparation(game,grenadiers.id);
    const shot=game.volleys.find(v=>v.squadId===grenadiers.id&&!v.melee&&v.targetId===rear.id)!;
    expect(shot).toBeDefined();
    expect(shot.tick).toBe(game.squad(grenadiers.id)!.weaponState!.rangedAction!.releaseTick);
    // Contact reservations still prevent a second full-squad ranged budget.
    const unit=UNIT.get(grenadiers.definitionId!)!;
    const reserved=contactParticipants(grenadiers,contact,game.tick,unit.meleeAttack!.ranks);
    const available=Math.min(attackContributors(grenadiers,unit.rangedAttack!),grenadiers.troops-reserved);
    const accuracy=weaponAccuracy(unit.rangedAttack!,Math.hypot(rear.x-grenadiers.x,rear.y-grenadiers.y));
    const expected=damageAmount(unit.rangedAttack!,tacticalDefence(grenadiers,rear,game.tick,'ranged',defenceOf(UNIT.get(rear.definitionId!)!)),available*accuracy);
    expect(shot.damage).toBe(expected);
    expect(game.squad(grenadiers.id)!.weaponState?.melee).toBeDefined();
    expect(game.squad(grenadiers.id)!.weaponState?.ranged).toBeDefined();
  });
  it("preserves independent hybrid combat through checkpoint restore", () => {
    const { game } = hybridCombatScene();
    game.expansion!.battle.fight([]);
    const restored = hybridCombatScene().game;
    restored.restore(game.checkpoint());
    for (let tick = 1; tick <= 130; tick++)
      for (const m of [game, restored]) {
        m.tick = tick;
        m.expansion!.battle.fight([]);
        m.expansion!.battle.advanceProjectiles();
      }
    expect(restored.checkpoint()).toEqual(game.checkpoint());
  });
});
