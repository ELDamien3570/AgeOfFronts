import type { Squad } from "../Protocol";

export const MAX_SELECTED_SQUADS = 30;

/** Presentation selection policy shared by every selection gesture. */
export function limitSquadSelection(
  selected: Set<number>,
  squads: readonly Pick<Squad, "id" | "troops" | "playerId" | "embarkedOn">[],
  playerId: number,
): void {
  if (selected.size <= MAX_SELECTED_SQUADS) return;
  const keep = new Set(squads
    .filter(s => selected.has(s.id) && s.playerId === playerId && s.embarkedOn === null && s.troops > 0)
    .sort((a, b) => b.troops - a.troops || a.id - b.id)
    .slice(0, MAX_SELECTED_SQUADS)
    .map(s => s.id));
  for (const id of selected) if (!keep.has(id)) selected.delete(id);
}
