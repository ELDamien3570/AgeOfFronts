import type { AttackProfile } from "./Definitions";

/** Expected hit contribution, after per-soldier armour subtraction.
 * One deterministic squad-level calculation; no per-soldier projectiles/RNG. */
export function weaponAccuracy(profile: AttackProfile, distance: number): number {
  if (profile.channel !== "ranged" || !profile.accuracy) return 1;
  const fraction = Math.max(0, Math.min(1, distance / Math.max(1, profile.range)));
  return Math.max(0, Math.min(100,
    profile.accuracy.near + (profile.accuracy.far - profile.accuracy.near) * fraction)) / 100;
}
