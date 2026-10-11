import type { TargetTag, UnitDefinition } from "../domain/Definitions";
import { FIXED } from "../Protocol";
import catalogue from "./soldier-weapons.json";
/** Explicit authored HP and cadence; no era exponential or sustained-DPS compensation. */
export function applySoldierWeapons(unit: UnitDefinition): void {
  const data = catalogue.weapons[unit.id as keyof typeof catalogue.weapons];
  if (!data) throw new Error(`Missing soldier weapons ${unit.id}`);
  const legacy = unit.attack;
  const bonuses = {
    [data.primaryBonus.target]: data.primaryBonus.damageHp,
  } as Partial<Record<TargetTag, number>>;
  unit.meleeAttack = {
    channel: "melee",
    perSoldier: true,
    damage: data.melee.damageHp,
    rpm: data.melee.rpm,
    ranks: data.melee.ranks,
    shotsPerReload: 1,
    reloadMs: 0,
    reloadTicks: Math.ceil(1200 / data.melee.rpm),
    movingReloadPercent: 100,
    // Physical weapon reach beyond the body, rather than legacy centre range.
    range: Math.round((unit.tags.includes("mounted") ? 0.75 : 0.5) * FIXED),
    targets: legacy.targets,
    bonuses,
    penetration: 0,
  };
  if (data.ranged)
    unit.rangedAttack = {
      ...legacy,
      channel: "ranged",
      perSoldier: true,
      damage: data.ranged.damageHp,
      rpm: data.ranged.rpm,
      shotsPerReload: data.ranged.shotsPerReload,
      reloadMs: data.ranged.reloadMs,
      reloadTicks: Math.ceil(1200 / data.ranged.rpm),
      bonuses,
      penetration: 0,
    };
  unit.attack = unit.rangedAttack ?? unit.meleeAttack;
  unit.meleeArmour = data.defence.meleeHp;
  unit.rangedArmour = data.defence.rangedHp;
  unit.armourKind = "points";
  unit.bonusResistance = {};
  delete unit.healthPercent;
  unit.chargeMultiplier = data.chargeMultiplier;
}
