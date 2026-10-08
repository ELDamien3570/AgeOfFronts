import type { Player, ShipType } from "./Protocol";
import { MAX_SHIPS } from "./Rules";
import { MAX_SQUADS } from "./Protocol";
import { AGES, type Age } from "./domain/Definitions";
import { TRADE_RULES } from "./content/Economy";

export const AGE_SQUAD_CAPS: Readonly<Record<Age, number>> = {
  StoneAge: 60,
  BronzeAge: 80,
  ClassicalAge: 100,
  EarlyMedieval: 120,
  LateMedieval: 140,
  Napoleonic: 160,
  EarlyModern: 180,
  Modern: 200,
};

// Base faction counts per map size (longest edge). Custom lobbies may choose
// any count from 0 up to the caps below, on any map size.
export const WORLD_FACTION_DEFAULTS = Object.freeze({
  250: Object.freeze({ aiCount: 6, tribeCount: 20 }),
  500: Object.freeze({ aiCount: 10, tribeCount: 25 }),
  1000: Object.freeze({ aiCount: 14, tribeCount: 30 }),
});
export type FactionWorldSize = keyof typeof WORLD_FACTION_DEFAULTS;
export const MAX_HUMAN_PLAYERS = 20;
export const MAX_AI_OPPONENTS = 14;
export const MAX_TRIBES = 30;
export const MAX_ORDER_SQUADS = 30;
export const AI_WARSHIP_CAP = 32;
export const TRIBE_WARSHIP_CAP = 24;
/** Military hull classes have independent slots; civilian trade has its own cap. */
export function shipCap(player: Pick<Player, "kind" | "ai">, kind: ShipType): number {
  return player.kind === "tribe" ? TRIBE_WARSHIP_CAP : player.ai ? AI_WARSHIP_CAP : MAX_SHIPS;
}
/** Humans + AI + tribes; owner IDs share a byte with the 255 contested marker. */
export const MAX_PLAYER_ID = MAX_HUMAN_PLAYERS + MAX_AI_OPPONENTS + MAX_TRIBES;

export function factionDefaults(worldSize: FactionWorldSize) {
  return WORLD_FACTION_DEFAULTS[worldSize];
}
/** Allowed lobby range for `aiCount` or `tribeCount`; the same on every map size. */
export function factionCountRange(
  _worldSize: FactionWorldSize,
  kind: "aiCount" | "tribeCount",
): { min: number; max: number } {
  return { min: 0, max: kind === "aiCount" ? MAX_AI_OPPONENTS : MAX_TRIBES };
}
export const TRIBE_STARTING_SQUADS = 4;
export const TRIBE_STARTING_RESERVES = 1500;
export const TRIBE_STARTING_GOLD = 150;
export const TRIBE_SQUAD_CAP = 10;
export const TRIBE_SQUADS_PER_AGE = 5;
export const TRIBE_TRADER_CAP = 16;
export const TRIBE_TRADERS_PER_AGE = 2;

export function tradeActorCap(player: Pick<Player, "kind">, age?: Age): number {
  return player.kind === "tribe" ? TRIBE_TRADER_CAP + TRIBE_TRADERS_PER_AGE * (age ? AGES.indexOf(age) : 0) : TRADE_RULES.actorCap;
}
export const TRIBE_BASE_RADIUS = 3;
export const TRIBE_CITY_BASE_RADIUS = 6;
export const TRIBE_INTERCEPT_RANGE = 8;
export const TRIBE_PURSUIT_RANGE = 12;
export const TRIBE_PROMOTION_PERCENT = 10;

export function canPromoteTribe(
  player: Pick<Player, "kind" | "land" | "eliminated">,
  landCells: number,
): boolean {
  return (
    player.kind === "tribe" &&
    !player.eliminated &&
    landCells > 0 &&
    player.land * 100 >= landCells * TRIBE_PROMOTION_PERCENT
  );
}
/** Default tribe count for a map, from its longest edge. */
export function tribeCountFor(width: number, height: number): number {
  const extent = Math.max(width, height);
  return WORLD_FACTION_DEFAULTS[
    extent <= 375 ? 250 : extent <= 750 ? 500 : 1000
  ].tribeCount;
}
/** Tribes a match deploys: the explicit count, else the map default. */
export function matchTribeCount(
  options: { tribes?: boolean; tribeCount?: number },
  width: number,
  height: number,
): number {
  if (!options.tribes) return 0;
  return options.tribeCount ?? tribeCountFor(width, height);
}

export function squadCap(player: Pick<Player, "kind">, age?: Age): number {
  // The legacy sandbox has no progression; its diagnostic ceiling remains 200.
  return player.kind === "tribe"
    ? TRIBE_SQUAD_CAP + TRIBE_SQUADS_PER_AGE * (age ? AGES.indexOf(age) : 0)
    : age
      ? AGE_SQUAD_CAPS[age]
      : MAX_SQUADS;
}
