import type { Building } from "../Protocol";
import { DEFENSIVE_BUILDINGS } from "../content/Buildings";

export function conquestBuildings(
  buildings: readonly Building[],
  ai: boolean,
): readonly Building[] {
  return buildings.filter(
    (b) =>
      !b.remainingTicks &&
      (b.health ?? 1) > 0 &&
      (!ai || !DEFENSIVE_BUILDINGS.includes(b.type)),
  );
}
export function canFinishConquest(
  buildings: number,
  enemySquads: number,
  ownSquads: number,
): boolean {
  return (
    ownSquads >= 2 &&
    buildings <= 4 &&
    enemySquads <= Math.max(2, Math.floor(ownSquads / 2))
  );
}
