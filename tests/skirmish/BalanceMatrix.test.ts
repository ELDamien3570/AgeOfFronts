// Analytic counter ratchet (05 rec 10). This is a closed-form model, not a
// simulation: it catches content edits that silently erase a counter, and it
// does not replace the engagement rows in PreModernBalance.test.ts.
//
// Model (per hit, as Combat.damageAmount resolves points armour):
//   soldier hit = max(1, damage - armour) + bonus[primaryCounterClass(defender)]
//   ranged rate = magazine / cycle, scaled by mean(near, far) accuracy, x capacity
//   melee rate  = rpm / 60 x frontage, frontage = min(cap, ceil(sqrt(cap) x 1.5) x ranks)
//   hull rate   = 8 / reloadTicks (8 ticks per second)
// Known limits: charge impacts and kiting are not modelled; blast splash is not
// modelled; the melee frontage heuristic is rough; losses during the fight are
// ignored (full-strength rates throughout).
//
// Exchange value of a counter C against a target T at equal gold:
//   E = (dps(C->T) / hp(T)) / (dps(T->C) / hp(C)) x gold(T) / gold(C)
// E > 1 means C's gold buys more killing than T's. Each row below is the value
// recorded when this test was written (branch aof/next-9). A row may not fall
// below COUNTER_RATCHET_FACTOR x its recorded value without a deliberate update
// here and in src/skirmish/content/BalanceContract.md.
import { describe, expect, it } from "vitest";
import { UNIT } from "../../src/skirmish/content/Units";
import { primaryCounterClass } from "../../src/skirmish/domain/Combat";
import { scaledRecipeCost } from "../../src/skirmish/domain/Manpower";
import type { UnitDefinition } from "../../src/skirmish/domain/Definitions";

/** Owner decision OD-17: 05 rec 10 gives no number. */
export const COUNTER_RATCHET_FACTOR = 0.9;

type Weapon = NonNullable<UnitDefinition["meleeAttack"]> | NonNullable<UnitDefinition["rangedAttack"]> | UnitDefinition["attack"];
const cap = (u: UnitDefinition) => u.formationRecipe!.capacity;
const hpPool = (u: UnitDefinition) => u.formationRecipe!.soldierHp * cap(u);
const gold = (u: UnitDefinition) => scaledRecipeCost(u, "base").gold ?? 0;

function hit(w: Weapon, def: UnitDefinition, perSoldier: boolean): number {
  if (!w.targets.some(t => def.tags.includes(t))) return 0;
  const armour = w.channel === "melee" ? def.meleeArmour : def.rangedArmour;
  if (perSoldier) {
    const primary = primaryCounterClass(def.tags);
    return Math.max(1, w.damage - armour) + (primary ? (w.bonuses[primary] ?? 0) : 0);
  }
  let d = Math.max(0, w.damage - armour);
  for (const tag of new Set(def.tags)) d += w.bonuses[tag] ?? 0;
  return Math.max(1, d);
}
export function squadDps(att: UnitDefinition, def: UnitDefinition): number {
  if (att.formationRecipe!.model !== "soldiers")
    return hit(att.attack, def, false) * 8 / att.attack.reloadTicks;
  let best = 0;
  if (att.rangedAttack) {
    const g = att.rangedAttack;
    const mag = g.shotsPerReload ?? 1, interval = 60 / (g.rpm ?? 60), reload = (g.reloadMs ?? 0) / 1000;
    const cycle = mag === 1 ? Math.max(interval, reload) : (mag - 1) * interval + Math.max(interval, reload);
    const accuracy = g.accuracy ? (g.accuracy.near + g.accuracy.far) / 200 : 1;
    best = Math.max(best, hit(g, def, true) * (mag / cycle) * accuracy * cap(att));
  }
  if (att.meleeAttack) {
    const m = att.meleeAttack;
    const front = Math.min(cap(att), Math.ceil(Math.sqrt(cap(att)) * 1.5) * (m.ranks ?? 1));
    best = Math.max(best, hit(m, def, true) * ((m.rpm ?? 60) / 60) * front);
  }
  return best;
}
export function exchangeValue(counterId: string, targetId: string): number {
  const c = UNIT.get(counterId)!, t = UNIT.get(targetId)!;
  const forward = squadDps(c, t) / hpPool(t), back = squadDps(t, c) / hpPool(c);
  if (back === 0) return Number.POSITIVE_INFINITY;
  return (forward / back) * (gold(t) / gold(c));
}

// [counter, target, recorded exchange value]. Contract rows: spearmen beat light
// cavalry; heavy cavalry beats spearmen; mainline infantry beats spearmen; foot
// archers beat infantry they can kite (analytic only: no kiting is modelled).
// Values below 1 are not equal-gold counters: heavy cavalry wins the one-on-one
// contract row but costs 4-9x a spearman, and archers depend on kiting. They are
// recorded so a further fall is still caught.
const RECORDED: ReadonlyArray<readonly [string, string, number]> = [
  ["bronzeage-anticavalry", "bronzeage-cavalry", 10.925],
  ["classicalage-anticavalry", "classicalage-cavalry", 11.280],
  ["earlymedieval-anticavalry", "earlymedieval-cavalry", 14.947],
  ["latemedieval-anticavalry", "latemedieval-cavalry", 9.007],
  ["earlymodern-anticavalry", "napoleonic-cavalry", 9.243],
  ["earlymedieval-heavycavalry", "earlymedieval-anticavalry", 0.086],
  ["latemedieval-heavycavalry", "latemedieval-anticavalry", 0.127],
  ["earlymodern-heavycavalry", "earlymodern-anticavalry", 0.130],
  ["bronzeage-infantry", "bronzeage-anticavalry", 7.953],
  ["classicalage-infantry", "classicalage-anticavalry", 6.949],
  ["earlymedieval-infantry", "earlymedieval-anticavalry", 7.125],
  ["latemedieval-infantry", "latemedieval-anticavalry", 7.404],
  ["bronzeage-archer", "bronzeage-infantry", 0.325],
  ["classicalage-archer", "classicalage-infantry", 0.299],
  ["earlymedieval-archer", "earlymedieval-infantry", 0.303],
  ["latemedieval-archer", "latemedieval-infantry", 0.267],
  ["napoleonic-archer", "napoleonic-infantry", 0.186],
];

describe("analytic balance matrix", () => {
  // Regenerate the recorded column: BALANCE_MATRIX_PRINT=1 npx vitest run ... --reporter=verbose
  it.runIf(!!process.env.BALANCE_MATRIX_PRINT)("prints the recorded table", () => {
    console.log(RECORDED.map(([c, t]) => `["${c}", "${t}", ${exchangeValue(c, t).toFixed(3)}],`).join("\n"));
  });
  it.each(RECORDED)("%s keeps its exchange value against %s", (counter, target, recorded) => {
    const value = exchangeValue(counter, target);
    expect(Number.isFinite(value) || value === Number.POSITIVE_INFINITY).toBe(true);
    expect(value).toBeGreaterThanOrEqual(recorded * COUNTER_RATCHET_FACTOR);
  });
});

// Content decisions (BalanceContract.md, "Content decisions"). Each row pins the
// value now authored in skirmish/plans/formation-recipes.json, so a change is
// deliberate. Only OD-12 changed content; the others keep HEAD pending the owner.
describe("content decisions", () => {
  it("OD-12: the Modern machine-gun crew has the Early Modern crew's 1000 HP (05 rec 1)", () => {
    expect(UNIT.get("modern-field-support")!.formationRecipe!.soldierHp).toBe(1000);
    expect(UNIT.get("earlymodern-field-support")!.formationRecipe!.soldierHp).toBe(1000);
  });
  it("OD-13: the RPL-20 crew keeps 100 HP and an enlarged size of 3 (contract text said 80 / 1)", () => {
    expect(UNIT.get("modern-archer")!.formationRecipe).toMatchObject({ capacity: 1, enlargedCapacity: 3, soldierHp: 100 });
  });
  it("OD-14: Bronze cavalry keeps 16 riders, 20 enlarged, 16 horses", () => {
    const u = UNIT.get("bronzeage-cavalry")!;
    expect(u.formationRecipe).toMatchObject({ capacity: 16, enlargedCapacity: 20 });
    expect(u.cost.items?.horses).toBe(16);
  });
  it("OD-15: medieval infantry keeps 40/50 and Napoleonic cavalry 48/64 (alternative 36/48 and 24/36)", () => {
    for (const id of ["earlymedieval-infantry", "latemedieval-infantry"])
      expect(UNIT.get(id)!.formationRecipe).toMatchObject({ capacity: 40, enlargedCapacity: 50 });
    expect(UNIT.get("napoleonic-cavalry")!.formationRecipe).toMatchObject({ capacity: 48, enlargedCapacity: 64 });
  });
});
