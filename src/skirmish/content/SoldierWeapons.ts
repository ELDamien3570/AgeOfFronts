import type { AttackProfile, TargetTag, UnitDefinition } from "../domain/Definitions";
import { FIXED, TICKS_PER_SECOND } from "../Protocol";
import catalogue from "./soldier-weapons.json";
interface Weapon {
  damageHp: number;
  rpm: number;
  ranks?: number;
  shotsPerReload?: number;
  reloadMs?: number;
  rangeTiles?: number;
  bonuses: Partial<Record<TargetTag, number>>;
  accuracy?: AttackProfile["accuracy"];
}
interface SoldierWeapons {
  melee: Weapon | null;
  ranged: Weapon | null;
  defence: { meleeHp: number; rangedHp: number };
  chargeMultiplier: number;
  chargeRecoveryTicks?: number;
}
/** Explicit authored HP and cadence; no era exponential or sustained-DPS compensation. */
export function applySoldierWeapons(unit: UnitDefinition): void {
  const data = (catalogue.weapons as Record<string, SoldierWeapons>)[unit.id];
  if (!data) throw new Error(`Missing soldier weapons ${unit.id}`);
  const legacy = unit.attack;
  unit.meleeAttack = data.melee ? {
    channel: "melee",
    perSoldier: true,
    damage: data.melee.damageHp,
    rpm: data.melee.rpm,
    ranks: data.melee.ranks,
    shotsPerReload: 1,
    reloadMs: 0,
    reloadTicks: Math.ceil((60 * TICKS_PER_SECOND) / data.melee.rpm),
    movingReloadPercent: 100,
    // Physical weapon reach beyond the body, rather than legacy centre range.
    range: Math.round((unit.tags.includes("mounted") ? 0.75 : 0.5) * FIXED),
    targets: legacy.targets,
    bonuses: data.melee.bonuses,
    penetration: 0,
  } : undefined;
  if (data.ranged)
    unit.rangedAttack = {
      ...legacy,
      channel: "ranged",
      perSoldier: true,
      damage: data.ranged.damageHp,
      rpm: data.ranged.rpm,
      shotsPerReload: data.ranged.shotsPerReload,
      reloadMs: data.ranged.reloadMs,
      reloadTicks: Math.ceil((60 * TICKS_PER_SECOND) / data.ranged.rpm),
      range: data.ranged.rangeTiles === undefined ? legacy.range : data.ranged.rangeTiles * FIXED,
      accuracy: data.ranged.accuracy,
      bonuses: data.ranged.bonuses,
      penetration: 0,
    };
  const primary = unit.rangedAttack ?? unit.meleeAttack;
  if (!primary) throw new Error(`Soldier has no weapon ${unit.id}`);
  unit.attack = primary;
  unit.meleeArmour = data.defence.meleeHp;
  unit.rangedArmour = data.defence.rangedHp;
  unit.armourKind = "points";
  unit.bonusResistance = {};
  delete unit.healthPercent;
  unit.chargeMultiplier = data.chargeMultiplier;
  unit.chargeRecoveryTicks = data.chargeRecoveryTicks;
}
