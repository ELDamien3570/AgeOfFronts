import { remainingHealth, HEALTH_SCALE } from "../../src/skirmish/domain/Manpower";
import { retainSquads } from "./UnitFixtures";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { technologyAt } from "../../src/skirmish/content/Technology";
import { defaultUnit, UNIT, VESSELS } from "../../src/skirmish/content/Units";
import { damageAmount, defenceOf } from "../../src/skirmish/domain/Combat";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { unitEffects } from "../../src/skirmish/domain/ResearchEffects";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("retained hull defence and explicit troop counters", () => {
  it("gives transports two early-age and three later-age same-age warship hits", () => {
    for (const [index, age] of AGES.entries()) {
      const transport = VESSELS.find(v => v.kind === "transport" && v.age === age)!,
        warship = VESSELS.find(v => v.kind === "warship" && v.age === age)!;
      const hit = damageAmount(warship.attack!, { tags: ["ship"], meleeArmour: 1000, rangedArmour: 2000, bonusResistance: {} });
      expect(transport.health).toBe(hit * (index < 4 ? 2 : 3));
      expect(Math.ceil(transport.health / hit)).toBe(index < 4 ? 2 : 3);
      expect(transport.speed).toBe(Math.round(warship.speed * 0.8));
    }
  });
  it("subtracts base and matching bonus armour independently, preserves minimum damage and percentage hulls", () => {
    const attack = {
      ...defaultUnit("infantry").attack,
      perSoldier: false,
      damage: 100,
      bonuses: { mounted: 30 },
    };
    const defence = {
      armourKind: "points" as const,
      tags: ["mounted" as const],
      meleeArmour: 80,
      rangedArmour: 999,
      bonusResistance: { mounted: 10 },
    };
    expect(damageAmount(attack, defence)).toBe(40);
    expect(damageAmount(attack, { ...defence, tags: ["infantry"] })).toBe(20);
    expect(
      damageAmount(attack, {
        ...defence,
        meleeArmour: 200,
        bonusResistance: { mounted: 50 },
      }),
    ).toBe(1);
    expect(damageAmount({ ...attack, penetration: 5000 }, defence)).toBe(80);
    expect(damageAmount(attack, { ...defence, cover: 2000 })).toBe(36);
    expect(
      damageAmount(attack, {
        ...defence,
        armourKind: "percentage",
        meleeArmour: 5000,
      }),
    ).toBe(70);
    expect(damageAmount(attack, defence, 500)).toBe(20);
    expect(damageAmount(attack, defence, 1000, 0, 1000, 1.2)).toBe(48);
    expect(damageAmount(attack, defence, 1000, 0, 1000, 0)).toBe(0);
  });
  // Blanket era superiority was retired with hidden era/health scaling in Phase 3.
  it("gives spear counters a contemporary cavalry bonus while archers target infantry", () => {
    const old = defaultUnit("archer", "BronzeAge"),
      contemporary = UNIT.get("classicalage-anticavalry")!,
      target = defaultUnit("cavalry", "ClassicalAge");
    const without = (u: typeof old) =>
      damageAmount({ ...u.attack, bonuses: {} }, defenceOf(target));
    expect(damageAmount(old.attack, defenceOf(target)) - without(old)).toBe(0);
    expect(
      damageAmount(contemporary.attack, defenceOf(target)) -
        without(contemporary),
    ).toBeGreaterThan(0);
  });
  it("applies troop strength after flat armour for both instant and committed projectile hits", () => {
    const terrain = new Uint8Array(80 * 50).fill(133),
      m = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      });
    const source = m.squads[0],
      target = m.squads.find((s) => s.playerId === 2)!;
    retainSquads(m, [source, target]);
    m.updateSquad(source.id, { x: 10 * FIXED });
    m.updateSquad(source.id, { y: 20 * FIXED }); m.updateSquad(target.id, { y: 20 * FIXED });
    m.updateSquad(target.id, { x: 20 * FIXED });
    m.updateSquad(target.id, { definitionId: "bronzeage-infantry" });
    const profile = {
      ...defaultUnit("infantry").attack,
      channel: "ranged" as const,
      perSoldier: false,
      damage: 200,
      bonuses: {},
      projectile: { diameter: FIXED / 4, speed: 30 * FIXED, blastRadius: 0 },
    };
    const expected = damageAmount(
      profile,
      defenceOf(defaultUnit("infantry", "BronzeAge")),
      500,
    );
    m.expansion!.battle.fire(
      { ...source, attackScale: 0.5 },
      { x: 35 * FIXED, y: target.y },
      profile,
      profile.damage,
    );
    for (const record of m.squads.slice(0, (0) + (1))) m.removeSquad(record.id); // Damage retains firing strength after the source dies.
    m.tick++;
    m.expansion!.battle.advanceProjectiles();
    expect(remainingHealth(target)).toBe((1200 - expected)*HEALTH_SCALE);
  });
});
