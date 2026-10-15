import { TICKS_PER_SECOND } from '../Protocol';
import { secondsToTicks } from '../Protocol';
import { FIXED } from "../Protocol";
import type { AttackProfile } from "../domain/Definitions";

// Shared by deployment/combat and technology inspection.
export const AIRCRAFT_RULES = {
  gold: 5000,
  airfieldCapacity: 6,
  factionCapacity: 32,
  health: 1000,
  fuelTicks: secondsToTicks(60),
  speed: 3600 / TICKS_PER_SECOND,
} as const;
export const BOMBER_ATTACK: AttackProfile = {
  channel: "ranged",
  damage: 2500,
  range: 0,
  reloadTicks: secondsToTicks(0.05),
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
  projectile: { diameter: FIXED / 3, speed: 20 * FIXED / TICKS_PER_SECOND, blastRadius: 4 * FIXED },
};
export const STRATEGIC_RULES = { gold: 10000, reloadTicks: secondsToTicks(60) } as const;
export const STRATEGIC_PAYLOADS = {
  icbm: { damage: 24000, blastRadius: 5 * FIXED, warheads: 0 },
  hydrogen: { damage: 40000, blastRadius: 28 * FIXED, warheads: 0 },
  mirv: { damage: 24000, blastRadius: 3 * FIXED, warheads: 8 },
} as const;

export const ATOMIC_ATTACK:AttackProfile={...BOMBER_ATTACK,damage:24000,projectile:{...BOMBER_ATTACK.projectile!,blastRadius:12*FIXED}};
export const DRONE_ATTACK:AttackProfile={...BOMBER_ATTACK,damage:10000,projectile:{...BOMBER_ATTACK.projectile!,blastRadius:3*FIXED}};
export const NAVAL_AIR_ATTACK:AttackProfile={...BOMBER_ATTACK,damage:200,range:12*FIXED,reloadTicks:secondsToTicks(2),targets:["aircraft"],projectile:{diameter:FIXED/5,speed:40*FIXED/TICKS_PER_SECOND,blastRadius:0}};
