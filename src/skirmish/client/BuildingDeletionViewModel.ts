import type { Command, Snapshot } from "../Protocol";

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
