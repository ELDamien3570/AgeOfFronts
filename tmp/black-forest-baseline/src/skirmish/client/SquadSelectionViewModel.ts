import type { Squad } from "../Protocol";
import { MAX_ORDER_SQUADS } from "../FactionRules";

export const MAX_SELECTED_SQUADS = MAX_ORDER_SQUADS;

interface DragSelection {
  selected: Set<number>;
  selectedShips: Set<number>;
  selectedAircraft: Set<number>;
}

/** Shift-drag targets ships; ordinary drag prioritizes ground troops. */
export function applyDragSelection(
  selection: DragSelection,
  candidates: { squads: readonly number[]; ships: readonly number[]; aircraft: readonly number[] },
  shift: boolean,
): void {
  selection.selected.clear();
  selection.selectedAircraft.clear();
  if (!shift) selection.selectedShips.clear();
  if (shift || (!candidates.squads.length && candidates.ships.length)) {
    for (const id of candidates.ships) selection.selectedShips.add(id);
  } else if (candidates.squads.length) {
    for (const id of candidates.squads) selection.selected.add(id);
  } else {
    for (const id of candidates.aircraft) selection.selectedAircraft.add(id);
  }
}

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
