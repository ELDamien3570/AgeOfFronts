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

export const MAX_TRIBES = 40;
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
export function tribeCountFor(width: number, height: number): number {
  const extent = Math.max(width, height);
  return extent <= 375 ? 20 : extent <= 750 ? 30 : MAX_TRIBES;
}

export function squadCap(player: Pick<Player, "kind">, age?: Age): number {
  // The legacy sandbox has no progression; its diagnostic ceiling remains 200.
  return player.kind === "tribe"
    ? TRIBE_SQUAD_CAP
    : age
      ? AGE_SQUAD_CAPS[age]
      : MAX_SQUADS;
}
