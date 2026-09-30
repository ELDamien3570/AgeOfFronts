import type { Player } from "./Protocol";
import { MAX_SQUADS } from "./Protocol";

export const MAX_TRIBES = 40;
export const TRIBE_STARTING_SQUADS = 5;
export const TRIBE_SQUAD_CAP = 10;
export const TRIBE_BASE_RADIUS = 3;
export const TRIBE_INTERCEPT_RANGE = 8;
export const TRIBE_PURSUIT_RANGE = 12;

export function tribeCountFor(width: number, height: number): number {
  const extent = Math.max(width, height);
  return extent <= 375 ? 10 : extent <= 750 ? 20 : MAX_TRIBES;
}

export function squadCap(player: Pick<Player, "kind">): number {
  return player.kind === "tribe" ? TRIBE_SQUAD_CAP : MAX_SQUADS;
}
