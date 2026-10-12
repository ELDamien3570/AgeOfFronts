import type { GameMap } from "../../core/game/GameMap";
import { ELEVATION } from "../content/TacticalRules";
import type { AttackProfile } from "./Definitions";
import { tacticalTerrain, type TacticalTerrain } from "./TacticalTerrain";
type Point = { x: number; y: number };
type TerrainWorld = { map?: GameMap; tacticalTerrain?: TacticalTerrain };
const NEUTRAL = Object.freeze({ rangeBp: 10000, damageBp: 10000 });
/** Bounded combat explanation: elevation multiplies base damage before armour. */
export function highGroundDamageModifier(damageBp:number):string {
  return `high ground +${(damageBp-10000)/100}% base damage`;
}
export function heightModifier(deltaDm: number) {
  if (deltaDm <= ELEVATION.minDeltaDm) return NEUTRAL;
  const delta = Math.min(deltaDm, ELEVATION.saturateDm) - ELEVATION.minDeltaDm;
  const span = ELEVATION.saturateDm - ELEVATION.minDeltaDm;
  return {
    rangeBp: 10000 + Math.floor((delta * ELEVATION.maxRangeBp) / span),
    damageBp: 10000 + Math.floor((delta * ELEVATION.maxDamageBp) / span),
  };
}
export function elevationModifier(
  terrain: TacticalTerrain | undefined,
  source: Point,
  target: Point,
) {
  return terrain?.hasHeight
    ? heightModifier(terrain.height(source) - terrain.height(target))
    : NEUTRAL;
}
export function terrainOf(world: TerrainWorld): TacticalTerrain | undefined {
  return (
    world.tacticalTerrain ??
    (world.map ? tacticalTerrain(world.map) : undefined)
  );
}
/** Literal soldier ranged weapons only; hull weapons and melee remain neutral. */
export function rangedElevation(
  world: TerrainWorld,
  source: Point,
  profile: AttackProfile,
  target?: Point,
) {
  return profile.channel === "ranged" &&
    profile.perSoldier &&
    target &&
    !(source as { afloat?: boolean }).afloat
    ? elevationModifier(terrainOf(world), source, target)
    : NEUTRAL;
}
export function effectiveRange(
  world: TerrainWorld,
  source: Point,
  profile: AttackProfile,
  target?: Point,
): number {
  return Math.floor(
    (profile.range * rangedElevation(world, source, profile, target).rangeBp) /
      10000,
  );
}
export function maxEffectiveRange(profile: AttackProfile): number {
  return profile.channel === "ranged" && profile.perSoldier
    ? Math.floor((profile.range * (10000 + ELEVATION.maxRangeBp)) / 10000)
    : profile.range;
}
export function elevationWeapon(
  world: TerrainWorld,
  source: Point,
  profile: AttackProfile,
  target?: Point,
): AttackProfile {
  return withElevation(
    profile,
    rangedElevation(world, source, profile, target).damageBp,
  );
}
/** Apply after promotion, before armour; class bonuses are never multiplied. */
export function withElevation(
  profile: AttackProfile,
  bp: number,
): AttackProfile {
  return profile.channel === "ranged" && profile.perSoldier && bp !== 10000
    ? {
        ...profile,
        damage:
          Math.floor((Math.round(profile.damage * 1000) * bp) / 10000) / 1000,
      }
    : profile;
}
export function elevationRangeAt(
  world: TerrainWorld,
  source: Point,
  profile: AttackProfile,
) {
  return (target: Point) => effectiveRange(world, source, profile, target);
}
