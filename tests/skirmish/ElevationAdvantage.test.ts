import { describe, expect, it } from "vitest";
import { damageAmount } from "../../src/skirmish/domain/Combat";
import {
  effectiveRange,
  heightModifier,
  maxEffectiveRange,
  rangedElevation,
} from "../../src/skirmish/domain/ElevationAdvantage";
import { tacticalTerrain } from "../../src/skirmish/domain/TacticalTerrain";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { FIXED } from "../../src/skirmish/Protocol";
import { hillDefenceScene } from "./fixtures/HillDefence";
describe("authoritative high ground", () => {
  it.each([
    [0, 10000],
    [59, 10000],
    [60, 10000],
    [230, 10500],
    [400, 11000],
    [1000, 11000],
  ])("bounds %i dm at %i bp", (delta, bp) => {
    expect(heightModifier(delta)).toEqual({ rangeBp: bp, damageBp: bp });
  });
  it("samples the carrier tile in integer decimetres without clipping mountain maps", () => {
    const map = createSkirmishMap(2, 1, new Uint8Array(2).fill(133), {
      values: new Float32Array([-4500, 6000]),
      minimum: -4500,
      maximum: 6000,
      seaLevel: 0,
    });
    const t = tacticalTerrain(map);
    expect(t.height({ x: FIXED, y: 0 })).toBe(60000);
    expect(t.heightAt(0)).toBe(-45000);
    expect(t.clampCount).toBe(0);
  });
  it("keeps melee, hull weapons, uphill fire and absent heights neutral", () => {
    const { game, riders, defenders } = hillDefenceScene(true),
      source = defenders[0],
      target = riders[0],
      p = game.expansion!.unit(source).attack;
    game.updateSquad(source.id, { x: 32 * FIXED, y: 32 * FIXED });
    game.updateSquad(target.id, { x: 32 * FIXED, y: 40 * FIXED });
    expect(rangedElevation(game, source, p, target).damageBp).toBe(11000);
    expect(effectiveRange(game, target, p, source)).toBe(p.range);
    for (const profile of [
      { ...p, channel: "melee" as const },
      { ...p, perSoldier: false },
    ])
      expect(effectiveRange(game, source, profile, target)).toBe(p.range);
    const flat = hillDefenceScene(true, false).game;
    expect(effectiveRange(flat, source, p, target)).toBe(p.range);
    expect(maxEffectiveRange(p)).toBe(Math.floor(p.range * 1.1));
  });
  it("adds height to promoted base damage before armour without multiplying class bonuses", () => {
    const { game, defenders } = hillDefenceScene(true),
      attack = {
        ...game.expansion!.unit(defenders[0]).attack,
        damage: 20,
        bonuses: { infantry: 10 },
        penetration: 0,
      };
    const defence = {
      tags: ["infantry"] as const,
      soldiers: true,
      armourKind: "points" as const,
      meleeArmour: 19,
      rangedArmour: 19,
      bonusResistance: {},
    };
    expect(damageAmount(attack, defence, 1, 0, 1000, undefined, 10000)).toBe(
      11,
    );
    expect(damageAmount(attack, defence, 1, 0, 1000, undefined, 11000)).toBe(
      13,
    );
    const unarmoured = { ...defence, rangedArmour: 0 };
    expect(
      damageAmount(attack, unarmoured, 1, 500, 1000, undefined, 11000),
    ).toBe(32.66);
  });
  it("captures projectile height at firing time and validates the committed fact on restore", () => {
    const { game, defenders, riders } = hillDefenceScene(true),
      e = game.expansion!,
      source = defenders[0],
      target = riders[0],
      profile = e.unit(source).attack;
    game.updateSquad(source.id, { x: 32 * FIXED, y: 32 * FIXED });
    game.updateSquad(target.id, { x: 32 * FIXED, y: 40 * FIXED });
    expect(
      e.battle.fire(
        source,
        target,
        profile,
        profile.damage,
        "shell",
        10,
        0,
        source.definitionId,
      ),
    ).toBe(true);
    const shot = e.battle.projectiles[0];
    expect(shot.elevationDamageBp).toBe(11000);
    expect(shot.damage).toBe(
      Math.floor(Math.round(profile.damage * 1000) * 1.1) / 1000,
    );
    expect(shot.bonuses).toEqual(profile.bonuses);
    game.updateSquad(source.id, { x: 4 * FIXED, y: 4 * FIXED });
    game.updateSquad(target.id, { x: 32 * FIXED, y: 32 * FIXED });
    expect(shot.elevationDamageBp).toBe(11000);
    const saved = e.battle.checkpoint();
    saved.projectiles[0].elevationDamageBp = 11001;
    expect(() => e.battle.restore(saved)).toThrow(/elevation/);
  });
});
