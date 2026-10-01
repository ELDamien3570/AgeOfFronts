import { FIXED } from "../Protocol";
import type { AttackProfile } from "../domain/Definitions";

// Existing playtest rules, shared by combat and inspection. Tower arrow values
// are still an open design decision; a tower does not borrow a mobile weapon.
export const GUN_NEST_ATTACK: AttackProfile = {
  channel: "ranged",
  damage: 180,
  range: 7 * FIXED,
  reloadTicks: 20,
  movingReloadPercent: 100,
  bonuses: { infantry: 80 },
  penetration: 0,
  targets: [
    "infantry",
    "ranged",
    "mounted",
    "vehicle",
    "siege",
    "structure",
    "wall",
    "ship",
  ],
};
export const TRENCH_COVER = Object.freeze({
  slots: 6,
  radius: FIXED,
  reduction: 2000,
});
