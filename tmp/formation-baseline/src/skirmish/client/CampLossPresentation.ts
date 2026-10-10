import type { Snapshot } from "../Protocol";

const NOTICE_DURATION_MS = 15_000;
const FADE_DURATION_MS = 3_000;

// A transient UI notice, independent of simulation speed and pause state.
// Retain the lost state after expiry so snapshots cannot restart the timer.
export class CampLossPresentation {
  private readonly camps = new Map<
    number,
    { lost: boolean; startedAt: number }
  >();

  reset(): void {
    this.camps.clear();
  }

  update(snapshot: Snapshot, now = performance.now()): void {
    const live = new Set<number>();
    for (const player of snapshot.players) {
      live.add(player.id);
      const lost =
        !player.eliminated && snapshot.owners[player.base] !== player.id;
      const previous = this.camps.get(player.id);
      if (previous?.lost === lost) continue;
      this.camps.set(player.id, { lost, startedAt: now });
    }
    for (const id of this.camps.keys())
      if (!live.has(id)) this.camps.delete(id);
  }

  opacity(playerId: number, now = performance.now()): number {
    const camp = this.camps.get(playerId);
    if (!camp?.lost) return 0;
    const remaining = NOTICE_DURATION_MS - Math.max(0, now - camp.startedAt);
    return Math.max(0, Math.min(1, remaining / FADE_DURATION_MS));
  }
}
