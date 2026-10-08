import { describe, expect, it } from "vitest";
import { UNITS } from "../../src/skirmish/content/Units";
import { damageAmount, defenceOf } from "../../src/skirmish/domain/Combat";
import {
  AGES,
  type UnitDefinition,
} from "../../src/skirmish/domain/Definitions";
const unit = (index: number, cls: string) =>
  UNITS.find((u) => u.age === AGES[index] && u.troopClass === cls)!;
// Resolve simultaneous stationary strikes through the actual cohort damage model;
// losses reduce subsequent attack strength. No invented per-soldier simulation.
function duel(a: UnitDefinition, b: UnitDefinition, headStart = 0) {
  let ah = 1000,
    bh = 1000;
  for (let tick = 0; tick < 20000 && ah > 0 && bh > 0; tick++) {
    const da =
      tick % a.attack.reloadTicks === 0
        ? damageAmount(a.attack, defenceOf(b), ah)
        : 0;
    const db =
      tick >= headStart && (tick - headStart) % b.attack.reloadTicks === 0
        ? damageAmount(b.attack, defenceOf(a), bh)
        : 0;
    ah = Math.max(0, ah - db);
    bh = Math.max(0, bh - da);
  }
  return { a: ah, b: bh };
}
describe("Russian troop counter relationships", () => {
  for (let index = 1; index <= 5; index++) {
    it(`${AGES[index]}: spears beat contemporary cavalry but lose to the next tier`, () => {
      const spear = unit(index, "antiCavalry"),
        light = unit(index, "lightCavalry");
      expect(duel(spear, light).a).toBeGreaterThan(0);
      if (index < 5) {
        const next = duel(spear, unit(index + 1, "lightCavalry"));
        expect(next.a).toBe(0);
        expect(next.b).toBeLessThan(900);
      }
      const heavy = unit(index, "heavyCavalry");
      if (heavy) expect(duel(spear, heavy).a).toBeGreaterThan(0);
    });
  }
  it("infantry beats archers at contact; a ranged head start reverses the result", () => {
    const infantry = unit(2, "frontline"),
      archer = unit(2, "rangedInfantry");
    expect(duel(infantry, archer).a).toBeGreaterThan(0);
    expect(duel(archer, infantry, 180).a).toBeGreaterThan(0);
  });
});
