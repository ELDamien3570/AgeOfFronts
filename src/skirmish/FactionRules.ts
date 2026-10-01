import type { Player } from "./Protocol";
import { MAX_SQUADS } from "./Protocol";
import type { Age } from "./domain/Definitions";

export const AGE_SQUAD_CAPS: Readonly<Record<Age, number>> = {
  StoneAge: 60,
  BronzeAge: 80,
  ClassicalAge: 100,
  EarlyMedieval: 120,
  LateMedieval: 140,
  EarlyModern: 160,
  Modern: 200,
};

// Base faction counts per map size (longest edge). Lobbies may adjust each count
// by FACTION_COUNT_ADJUSTMENT; the large map's upper bounds set the global caps.
export const WORLD_FACTION_DEFAULTS = Object.freeze({
  250: Object.freeze({ aiCount: 8, tribeCount: 20 }),
  500: Object.freeze({ aiCount: 12, tribeCount: 30 }),
  1000: Object.freeze({ aiCount: 16, tribeCount: 40 }),
});
export type FactionWorldSize = keyof typeof WORLD_FACTION_DEFAULTS;
export const FACTION_COUNT_ADJUSTMENT = 5;
export const MAX_HUMAN_PLAYERS = 20;
export const MAX_AI_OPPONENTS =
  WORLD_FACTION_DEFAULTS[1000].aiCount + FACTION_COUNT_ADJUSTMENT;
export const MAX_TRIBES =
  WORLD_FACTION_DEFAULTS[1000].tribeCount + FACTION_COUNT_ADJUSTMENT;
/** Humans + AI + tribes; owner IDs share a byte with the 255 contested marker. */
export const MAX_PLAYER_ID = MAX_HUMAN_PLAYERS + MAX_AI_OPPONENTS + MAX_TRIBES;

export function factionDefaults(worldSize: FactionWorldSize) {
  return WORLD_FACTION_DEFAULTS[worldSize];
}
/** Allowed lobby range for `aiCount` or `tribeCount` at a map size. */
export function factionCountRange(
  worldSize: FactionWorldSize,
  kind: "aiCount" | "tribeCount",
): { min: number; max: number } {
  const base = WORLD_FACTION_DEFAULTS[worldSize][kind];
  return {
    min: Math.max(0, base - FACTION_COUNT_ADJUSTMENT),
    max: base + FACTION_COUNT_ADJUSTMENT,
  };
}
export const TRIBE_STARTING_SQUADS = 5;
export const TRIBE_SQUAD_CAP = 10;
export const TRIBE_BASE_RADIUS = 3;
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
    ? TRIBE_SQUAD_CAP
    : age
      ? AGE_SQUAD_CAPS[age]
      : MAX_SQUADS;
}
