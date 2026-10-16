/** U5 (R2-P4, owner decision D9): at most this many individually drawn
 * soldiers per frame. Squads outside the budget keep the era sprite path. */
export const SOLDIER_DETAIL_BUDGET = 2500;

export interface DetailCandidate {
  id: number;
  /** Soldiers this squad would draw. */
  soldiers: number;
  /** Selected or inspected squads are served first. */
  selected: boolean;
  /** Squared screen distance from the viewport centre. */
  distance: number;
}

/** Chooses the squads drawn as individual soldiers before any per-squad draw,
 * so the choice never depends on draw order: selected or inspected first, then
 * nearest to the screen centre, then by id. A squad that does not fit is
 * skipped and smaller squads further out may still fit. */
export function selectDetailedSquads(
  candidates: readonly DetailCandidate[],
  budget = SOLDIER_DETAIL_BUDGET,
): Set<number> {
  const ordered = [...candidates].sort((a, b) =>
    Number(b.selected) - Number(a.selected) || a.distance - b.distance || a.id - b.id);
  const chosen = new Set<number>();
  let used = 0;
  for (const candidate of ordered) {
    const soldiers = Math.max(0, candidate.soldiers);
    if (used + soldiers > budget) continue;
    used += soldiers;
    chosen.add(candidate.id);
  }
  return chosen;
}
