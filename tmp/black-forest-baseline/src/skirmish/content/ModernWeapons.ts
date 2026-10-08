import { FIXED } from "../Protocol";
import type { AttackProfile } from "../domain/Definitions";

// Shared by deployment/combat and technology inspection.
export const AIRCRAFT_RULES = {
  gold: 5000,
  airfieldCapacity: 6,
  factionCapacity: 32,
  health: 1000,
  fuelTicks: 1200,
  speed: 180,
} as const;
export const BOMBER_ATTACK: AttackProfile = {
  channel: "ranged",
  damage: 2500,
  range: 0,
  reloadTicks: 1,
  movingReloadPercent: 100,
  bonuses: { structure: 2000 },
  penetration: 2000,
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
  projectile: { diameter: FIXED / 3, speed: FIXED, blastRadius: 4 * FIXED },
};
export const STRATEGIC_RULES = { gold: 10000, reloadTicks: 1200 } as const;
export const STRATEGIC_PAYLOADS = {
  icbm: { damage: 24000, blastRadius: 5 * FIXED, warheads: 0 },
  hydrogen: { damage: 40000, blastRadius: 28 * FIXED, warheads: 0 },
  mirv: { damage: 24000, blastRadius: 3 * FIXED, warheads: 8 },
} as const;
