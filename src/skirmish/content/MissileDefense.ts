import { FIXED } from "../Protocol";

export const MISSILE_DEFENSE_RELOAD_TICKS = 400;
export const MISSILE_DEFENSE_SPEED = 4 * FIXED;
/** Coverage plateaus at ten; each physical launcher retains its own reload. */
export function missileDefenseRange(stack: number): number {
  const level = Math.max(1, Math.min(10, Math.floor(stack)));
  return (level < 5 ? 14 + 4 * (level - 1) : 32 + 8 * (level - 5)) * FIXED;
}
