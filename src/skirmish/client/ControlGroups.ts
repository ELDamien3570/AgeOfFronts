import type { Snapshot } from "../Protocol";

export interface UnitSelection {
  selected: Set<number>;
  selectedShips: Set<number>;
}

// Control groups remember client selection, not gameplay orders or ownership.
export class ControlGroups {
  private readonly groups = new Map<number, UnitSelection>();

  reset(): void {
    this.groups.clear();
  }

  prune(snapshot: Snapshot): void {
    const squads = new Set(
      snapshot.squads.filter((s) => s.playerId === (snapshot.localPlayerId ?? 1)).map((s) => s.id),
    );
    const ships = new Set(
      snapshot.ships.filter((s) => s.playerId === (snapshot.localPlayerId ?? 1)).map((s) => s.id),
    );
    for (const group of this.groups.values()) {
      for (const id of group.selected)
        if (!squads.has(id)) group.selected.delete(id);
      for (const id of group.selectedShips)
        if (!ships.has(id)) group.selectedShips.delete(id);
    }
  }

  bind(
    digit: number,
    selection: UnitSelection,
    snapshot: Snapshot,
    additive: boolean,
  ): void {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return;
    this.prune(snapshot);
    const group = additive ? this.groups.get(digit) : undefined;
    this.groups.set(digit, {
      selected: new Set([...(group?.selected ?? []), ...selection.selected]),
      selectedShips: new Set([
        ...(group?.selectedShips ?? []),
        ...selection.selectedShips,
      ]),
    });
    this.prune(snapshot);
  }

  recall(digit: number, snapshot: Snapshot): UnitSelection {
    this.prune(snapshot);
    const group = this.groups.get(digit);
    return {
      selected: new Set(
        snapshot.squads
          .filter(
            (s) =>
              s.playerId === (snapshot.localPlayerId ?? 1) &&
              s.embarkedOn === null &&
              group?.selected.has(s.id),
          )
          .map((s) => s.id),
      ),
      selectedShips: new Set(group?.selectedShips ?? []),
    };
  }

  count(digit: number): number {
    const group = this.groups.get(digit);
    return (group?.selected.size ?? 0) + (group?.selectedShips.size ?? 0);
  }
}
