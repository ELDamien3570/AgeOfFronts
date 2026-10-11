import { formationDoctrine, columnLayout } from "./FormationGeometry";
import type { Squad } from "../Protocol";
import type { AttackProfile, TargetTag, UnitDefinition } from "./Definitions";
export const XP_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000] as const;
export const PROMOTION_ATTACK = [
  10000, 10300, 10600, 11000, 11300, 11600, 12000,
] as const;
export const MAX_ARMOUR = 8000;
export function promotionLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++)
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  return level;
}
export interface Defence {
  soldiers?: boolean;
  tags: readonly TargetTag[];
  armourKind?: "points" | "percentage";
  meleeArmour: number;
  rangedArmour: number;
  bonusResistance: Partial<Record<TargetTag, number>>;
  cover?: number;
  healthPercent?: number;
}
export function attackStrength(
  strength: number,
  capacity: number,
  xp = 0,
): number {
  if (capacity <= 0) return 0;
  return (
    (Math.max(0, Math.min(1, strength / capacity)) *
      PROMOTION_ATTACK[promotionLevel(xp) - 1]) /
    10000
  );
}
export function scaledAttack(
  profile: AttackProfile,
  strength: number,
  capacity: number,
  xp = 0,
): AttackProfile {
  const scale = attackStrength(strength, capacity, xp);
  const scaleValue = (n: number) =>
    profile.perSoldier
      ? Math.floor(
          (Math.round(n * 1000) *
            Math.max(0, Math.min(strength, capacity)) *
            PROMOTION_ATTACK[promotionLevel(xp) - 1]) /
            Math.max(1, capacity * 10000),
        ) / 1000
      : Math.floor(n * scale);
  return {
    ...profile,
    damage: scaleValue(profile.damage),
    bonuses: Object.fromEntries(
      Object.entries(profile.bonuses).map(([tag, n]) => [tag, profile.perSoldier ? n : scaleValue(n)]),
    ),
  };
}
// Soldier armour subtracts from each contributor before aggregation; one
// primary-class bonus bypasses it. Legacy aggregate weapons retain their own
// hull/structure and bonus-resistance path. Cover mitigates the final aggregate.
export function damageAmount(
  profile: AttackProfile,
  defence: Defence,
  troops = profile.perSoldier ? 1 : 1000,
  xp = 0,
  capacity = 1000,
  committedStrength?: number,
): number {
  if (
    troops <= 0 ||
    (committedStrength !== undefined && committedStrength <= 0)
  )
    return 0;
  if (!profile.targets.some((tag) => defence.tags.includes(tag))) return 0;
  // Promotion changes the displayed per-unit weapon before armour. Surviving
  // troop count scales the resolved per-unit damage, not armour penetration.
  const attack = xp ? scaledAttack(profile, 1000, 1000, xp) : profile;
  if (profile.perSoldier) {
    const contributors = committedStrength ?? troops;
    if (!attack.damage || contributors <= 0) return 0;
    const armour = Math.max(
      0,
      attack.channel === "melee" ? defence.meleeArmour : defence.rangedArmour,
    );
    const penetration = Math.max(0, Math.min(10000, attack.penetration));
    // Primary class is exclusive; permission tags never multiply counter bonuses.
    const primary = primaryCounterClass(defence.tags);
    const bonus = primary
      ? Math.max(
          0,
          (attack.bonuses[primary] ?? 0) -
            (defence.soldiers === false
              ? (defence.bonusResistance[primary] ?? 0)
              : 0),
        )
      : 0;
    const damageSubunits = Math.round(attack.damage * 1000);
    const base =
      defence.armourKind === "points"
        ? Math.max(
            defence.soldiers === false ? 0 : 1000,
            damageSubunits -
              Math.floor(
                (Math.round(armour * 1000) * (10000 - penetration)) / 10000,
              ),
          )
        : Math.floor(
            (damageSubunits *
              (10000 -
                Math.floor(
                  (Math.min(MAX_ARMOUR, armour) * (10000 - penetration)) /
                    10000,
                ))) /
              10000,
          );
    const cover = Math.min(MAX_ARMOUR, Math.max(0, defence.cover ?? 0));
    return (
      Math.floor(
        ((base + Math.round(bonus * 1000)) * contributors * (10000 - cover)) /
          10000,
      ) / 1000
    );
  }
  const armour = Math.max(
    0,
    attack.channel === "melee" ? defence.meleeArmour : defence.rangedArmour,
  );
  const reduction = Math.min(
    MAX_ARMOUR,
    Math.max(0, defence.armourKind === "points" ? 0 : armour) +
      (defence.cover ?? 0),
  );
  const effective = Math.floor(
    (reduction * (10000 - attack.penetration)) / 10000,
  );
  const base =
    defence.armourKind === "points"
      ? Math.max(
          0,
          attack.damage -
            Math.floor((armour * (10000 - attack.penetration)) / 10000),
        )
      : attack.damage;
  let damage = Math.floor((base * (10000 - effective)) / 10000);
  for (const tag of new Set(defence.tags))
    damage += Math.max(
      0,
      (attack.bonuses[tag] ?? 0) - (defence.bonusResistance[tag] ?? 0),
    );
  return Math.max(
    1,
    Math.floor(
      (damage * (committedStrength ?? attackStrength(troops, capacity)) * 100) /
        (defence.healthPercent ?? 100),
    ),
  );
}
export function primaryCounterClass(
  tags: readonly TargetTag[],
): TargetTag | undefined {
  return (
    [
      "wall",
      "structure",
      "ship",
      "aircraft",
      "vehicle",
      "siege",
      "mounted",
      "ranged",
      "infantry",
    ] as const
  ).find((tag) => tags.includes(tag));
}
/** Non-contact estimate for AI, projectiles and legacy fixtures. Live formation melee uses FormationContact.contactParticipants. */
export function attackContributors(
  squad: Pick<Squad, "troops" | "manpower" | "formation" | "definitionId">,
  profile: AttackProfile,
  target?: Pick<Squad, "troops" | "manpower">,
): number {
  if (!profile.perSoldier)
    return (1000 * squad.troops) / (squad.manpower?.capacity ?? 1000);
  const column=squad.formation?.shape==="column" || squad.formation?.transition?.from==="column";
  const columnWidth=columnLayout(formationDoctrine(squad.definitionId)).columns;
  if (profile.channel === "ranged") return column ? Math.min(squad.troops,columnWidth*2):squad.troops;
  const width = column ? columnWidth : Math.ceil(Math.sqrt(squad.manpower?.capacity ?? squad.troops));
  const targetWidth = target
    ? Math.ceil(Math.sqrt(target.manpower?.capacity ?? target.troops))
    : width;
  return Math.min(
    squad.troops,
    Math.min(width, targetWidth) * (profile.ranks ?? 2),
  );
}
/** Every hull, including a squad afloat in its faction's transport. */
export const SHIP_DEFENCE: Defence = {
  tags: ["ship"],
  meleeArmour: 1000,
  rangedArmour: 2000,
  bonusResistance: {},
};
export function defenceOf(definition: UnitDefinition, cover = 0): Defence {
  return {
    ...definition,
    soldiers: definition.formationRecipe?.model === "soldiers",
    cover,
  };
}
export function attackInterval(
  profile: AttackProfile,
  moving: boolean,
): number {
  return moving
    ? Math.ceil((profile.reloadTicks * profile.movingReloadPercent) / 100)
    : profile.reloadTicks;
}
export function effectiveDamageShares<T extends number | string>(
  applied: number,
  contributions: readonly { id: T; damage: number }[],
): Map<T, number> {
  const output = new Map<T, number>(),
    sorted = [
      ...contributions.reduce(
        (map, c) => map.set(c.id, (map.get(c.id) ?? 0) + c.damage),
        new Map<T, number>(),
      ),
    ]
      .map(([id, damage]) => ({ id, damage }))
      .filter((c) => c.damage > 0)
      .sort((a, b) =>
        typeof a.id === "number" && typeof b.id === "number"
          ? a.id - b.id
          : String(a.id).localeCompare(String(b.id), "en"),
      );
  if (!sorted.length || applied <= 0) return output;
  const total = sorted.reduce((sum, item) => sum + item.damage, 0);
  let remaining = applied;
  for (const item of sorted) {
    const share = Math.min(
      remaining,
      Math.floor((applied * item.damage) / total),
    );
    output.set(item.id, share);
    remaining -= share;
  }
  for (const item of sorted) {
    if (!remaining) break;
    output.set(item.id, output.get(item.id)! + 1);
    remaining--;
  }
  return output;
}
