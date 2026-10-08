import type { Command, Snapshot } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import { AGES, AGE_NAMES } from "../domain/Definitions";

/** Confirmation intent pins one identity, never a stack or current selection. */
export class BuildingDeletionViewModel {
  pendingId: number | null = null;
  private eligible(state: Snapshot, playerId: number, id: number): boolean {
    const player = state.players.find((p) => p.id === playerId);
    const building = state.buildings.find((b) => b.id === id);
    return (
      !!player &&
      !player.ai &&
      !player.eliminated &&
      !!building &&
      building.playerId === playerId &&
      state.owners[building.tile] === playerId
    );
  }
  request(state: Snapshot, playerId: number, id: number): boolean {
    this.pendingId = this.eligible(state, playerId, id) ? id : null;
    return this.pendingId !== null;
  }
  reconcile(state: Snapshot, playerId: number): void {
    if (
      this.pendingId !== null &&
      !this.eligible(state, playerId, this.pendingId)
    )
      this.cancel();
  }
  message(state: Snapshot): string {
    const building = state.buildings.find((b) => b.id === this.pendingId);
    if (!building) return "";
    const tier = AGES.indexOf(building.age ?? "StoneAge");
    return `Delete ${BUILDING_RULES[building.type].name} — Level ${tier + 1} (${AGE_NAMES[tier]})?`;
  }
  cancel(): void {
    this.pendingId = null;
  }
  confirm(state: Snapshot, playerId: number): Command | undefined {
    const id = this.pendingId;
    this.cancel();
    return id !== null && this.eligible(state, playerId, id)
      ? { type: "delete-building", playerId, buildingId: id }
      : undefined;
  }
}
