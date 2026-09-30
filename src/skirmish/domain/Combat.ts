import type { AttackProfile, TargetTag, UnitDefinition } from "./Definitions";
export const XP_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000] as const;
const PROMOTION_ATTACK = [10000, 10300, 10600, 11000, 11300, 11600, 12000];
export function promotionLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++)
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  return level;
}
export interface Defence {
  tags: readonly TargetTag[];
  meleeArmour: number;
  rangedArmour: number;
  bonusResistance: Partial<Record<TargetTag, number>>;
  cover?: number;
}
// Armour is basis points. Bonus classes are distinct from the base armour
// channel; duplicate/overlapping presentation categories never create bonuses.
export function damageAmount(
  profile: AttackProfile,
  defence: Defence,
  troops = 1000,
  xp = 0,
): number {
  if (troops <= 0) return 0;
  if (!profile.targets.some((tag) => defence.tags.includes(tag))) return 0;
  const reduction = Math.min(
    8000,
    Math.max(
      0,
      profile.channel === "melee" ? defence.meleeArmour : defence.rangedArmour,
    ) + (defence.cover ?? 0),
  );
  const effective = Math.floor(
    (reduction * (10000 - profile.penetration)) / 10000,
  );
  let damage = Math.floor((profile.damage * (10000 - effective)) / 10000);
  for (const tag of new Set(defence.tags))
    damage += Math.max(
      0,
      (profile.bonuses[tag] ?? 0) - (defence.bonusResistance[tag] ?? 0),
    );
  return Math.max(
    1,
    Math.floor(
      (damage *
        Math.max(0, Math.min(1000, troops)) *
        PROMOTION_ATTACK[promotionLevel(xp) - 1]) /
        10_000_000,
    ),
  );
}
export function defenceOf(definition: UnitDefinition, cover = 0): Defence {
  return { ...definition, cover };
}
export function attackInterval(
  profile: AttackProfile,
  moving: boolean,
): number {
  return moving
    ? Math.ceil((profile.reloadTicks * profile.movingReloadPercent) / 100)
    : profile.reloadTicks;
}
export function effectiveDamageShares(
  applied: number,
  contributions: readonly { id: number; damage: number }[],
): Map<number, number> {
  const output = new Map<number, number>(),
    sorted = [
      ...contributions.reduce(
        (map, c) => map.set(c.id, (map.get(c.id) ?? 0) + c.damage),
        new Map<number, number>(),
      ),
    ]
      .map(([id, damage]) => ({ id, damage }))
      .filter((c) => c.damage > 0)
      .sort((a, b) => a.id - b.id);
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
