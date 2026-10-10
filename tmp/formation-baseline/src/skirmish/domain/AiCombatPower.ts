import type { Squad } from "../Protocol";
import {
  damageAmount,
  defenceOf,
  promotionLevel,
  XP_THRESHOLDS,
} from "./Combat";
import type { UnitDefinition } from "./Definitions";
import type { Expansion } from "./Expansion";

interface Cohort {
  unit: UnitDefinition;
  strength: number;
  xp: number;
}
/** Advisory comparisons use the combat resolver, never a second damage rule.
 * Aggregate by authored definition so evaluation scales with army composition. */
export function combatCohorts(
  expansion: Expansion,
  squads: readonly Squad[],
): Cohort[] {
  const rows = new Map<string, Cohort>();
  for (const squad of squads) {
    if (squad.troops <= 0 || squad.embarkedOn !== null || squad.refit) continue;
    const unit = expansion.unit(squad),
      level = promotionLevel(squad.xp ?? 0),
      key = `${unit.id}:${level}`;
    const cohort = rows.get(key) ?? {
      unit,
      strength: 0,
      xp: XP_THRESHOLDS[level - 1],
    };
    cohort.strength += squad.troops / 1000;
    rows.set(key, cohort);
  }
  return [...rows.values()];
}
function pressure(own: readonly Cohort[], enemy: readonly Cohort[]): number {
  const total = enemy.reduce((n, row) => n + row.strength, 0);
  if (!total) return own.reduce((n, row) => n + row.strength, 0) * 100;
  let result = 0;
  for (const a of own)
    for (const b of enemy)
      result +=
        (damageAmount(a.unit.attack, defenceOf(b.unit), 1000, a.xp) *
          a.strength *
          b.strength *
          Math.min(
            1.5,
            Math.sqrt(
              Math.max(1, a.unit.attack.range) /
                Math.max(1, b.unit.attack.range),
            ),
          )) /
        (total * Math.max(1, a.unit.attack.reloadTicks));
  return result;
}
export function combatAdvantage(
  own: readonly Cohort[],
  enemy: readonly Cohort[],
): number {
  if (!own.length) return 0;
  if (!enemy.length) return 8;
  return Math.min(
    8,
    pressure(own, enemy) / Math.max(0.01, pressure(enemy, own)),
  );
}
