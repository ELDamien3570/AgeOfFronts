import type { Building } from "../Protocol";

export function conquestBuildings(
  buildings: readonly Building[],
  _ai: boolean,
): readonly Building[] {
  return buildings.filter(
    (b) =>
      b.type === "city" && !b.remainingTicks &&
      (b.health ?? 1) > 0,
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
