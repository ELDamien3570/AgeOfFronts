import type { Building } from "../Protocol";

/** Selection membership and inspection focus are presentation state. */
export class BuildingSelectionViewModel {
  readonly ids = new Set<number>();
  focused: number | null = null;

  clear(): void {
    this.ids.clear();
    this.focused = null;
  }

  select(
    buildings: readonly Building[],
    additive = false,
    toggle = false,
  ): void {
    if (!additive) this.clear();
    const remove = toggle && buildings.every((b) => this.ids.has(b.id));
    for (const building of buildings) {
      if (remove) this.ids.delete(building.id);
      else this.ids.add(building.id);
    }
    this.focused = remove
      ? (this.ids.values().next().value ?? null)
      : (buildings[0]?.id ?? this.focused);
  }

  reconcile(buildings: readonly Building[], playerId: number): void {
    const ownedFocus = this.ids.has(this.focused!);
    const own = new Set(
      buildings
        .filter((b) => b.playerId === playerId && (b.health ?? 1) > 0)
        .map((b) => b.id),
    );
    for (const id of this.ids) if (!own.has(id)) this.ids.delete(id);
    if (this.ids.size && !this.ids.has(this.focused!))
      this.focused = this.ids.values().next().value!;
    else if (ownedFocus && !this.ids.size) this.focused = null;
    else if (!buildings.some((b) => b.id === this.focused)) this.focused = null;
  }
}
