import { UNIT } from "../../content/Units";
import type {
  AttackProfile,
  TargetTag,
  UnitDefinition,
} from "../../domain/Definitions";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";

export interface WeaponTuning {
  damage?: number;
  rpm?: number;
  rangeTiles?: number;
  reloadSeconds?: number;
  accuracyNear?: number;
  accuracyFar?: number;
  bonuses?: Partial<Record<TargetTag, number>>;
}
export interface BattleTuning {
  hp?: number;
  meleeArmour?: number;
  rangedArmour?: number;
  speedPercent?: number;
  chargeMultiplier?: number;
  chargeBonusSeconds?: number;
  melee?: WeaponTuning;
  ranged?: WeaponTuning;
  attack?: WeaponTuning;
}
export type RecipeTunings = Readonly<Record<string, BattleTuning>>;
export const BATTLE_BONUS_TAGS: readonly TargetTag[] = [
  "infantry",
  "ranged",
  "mounted",
  "vehicle",
  "siege",
  "ship",
  "aircraft",
  "structure",
  "wall",
  "armoured",
];
function bounded(value: number | undefined, min: number, max: number): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < min || value > max)
  )
    throw Error(`Stat must be between ${min} and ${max}`);
}
export function battleDefinition(
  id: string,
  tuning: BattleTuning = {},
  source?: UnitDefinition,
): UnitDefinition {
  const base = source ?? UNIT.get(id);
  if (!base || base.id !== id) throw Error("Unknown land unit");
  bounded(tuning.hp, 1, 100000);
  bounded(tuning.meleeArmour, 0, 10000);
  bounded(tuning.rangedArmour, 0, 10000);
  bounded(tuning.speedPercent, 1, 1000);
  bounded(tuning.chargeMultiplier, 1, 10);
  bounded(tuning.chargeBonusSeconds, 0, 120);
  const unit = structuredClone(base);
  if (tuning.chargeBonusSeconds !== undefined) {
    if (!unit.charge) throw Error("This unit cannot charge");
    unit.charge.bonusDurationTicks = Math.round(
      tuning.chargeBonusSeconds * TICKS_PER_SECOND,
    );
  }
  const weapon = (
    profile: AttackProfile | undefined,
    patch: WeaponTuning | undefined,
  ) => {
    if (!patch) return profile;
    if (!profile) throw Error("This unit does not have that weapon");
    bounded(patch.damage, 0, 100000);
    bounded(patch.rpm, 1, 1200);
    bounded(patch.rangeTiles, 0.05, 64);
    bounded(patch.reloadSeconds, 0, 120);
    bounded(patch.accuracyNear, 0, 100);
    bounded(patch.accuracyFar, 0, 100);
    for (const value of Object.values(patch.bonuses ?? {}))
      bounded(value, 0, 100000);
    const next = {
      ...profile,
      bonuses: { ...profile.bonuses, ...patch.bonuses },
    };
    if (patch.damage !== undefined) next.damage = patch.damage;
    if (patch.rpm !== undefined) {
      next.rpm = patch.rpm;
      next.reloadTicks = Math.ceil((60 * TICKS_PER_SECOND) / patch.rpm);
    }
    if (patch.rangeTiles !== undefined)
      next.range = Math.round(patch.rangeTiles * FIXED);
    if (patch.reloadSeconds !== undefined)
      next.reloadMs = Math.round(patch.reloadSeconds * 1000);
    if (patch.accuracyNear !== undefined || patch.accuracyFar !== undefined)
      next.accuracy = {
        near: patch.accuracyNear ?? profile.accuracy?.near ?? 100,
        far: patch.accuracyFar ?? profile.accuracy?.far ?? 100,
      };
    return next;
  };
  unit.meleeAttack = weapon(unit.meleeAttack, tuning.melee);
  unit.rangedAttack = weapon(unit.rangedAttack, tuning.ranged);
  unit.attack =
    unit.rangedAttack ??
    unit.meleeAttack ??
    weapon(unit.attack, tuning.attack)!;
  if (tuning.hp !== undefined)
    unit.formationRecipe = { ...unit.formationRecipe!, soldierHp: tuning.hp };
  for (const key of [
    "meleeArmour",
    "rangedArmour",
    "speedPercent",
    "chargeMultiplier",
  ] as const) {
    if (tuning[key] !== undefined) unit[key] = tuning[key]!;
  }
  return unit;
}
