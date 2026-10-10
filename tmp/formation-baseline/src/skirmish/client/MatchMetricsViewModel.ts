import type { Snapshot } from "../Protocol";

/** Match totals projected from the authoritative casualty and cargo ledgers. */
export class MatchMetricsViewModel {
  readonly kills: number;
  readonly deaths: number;
  readonly tradeCaptured: number;
  readonly tradeLost: number;

  constructor(snapshot: Snapshot, playerId: number) {
    const player = snapshot.players.find((p) => p.id === playerId);
    this.kills = player?.kills ?? 0;
    this.deaths = player?.losses ?? 0;
    this.tradeCaptured =
      snapshot.expansion?.tradeCapturedValue?.[playerId] ?? 0;
    this.tradeLost = snapshot.expansion?.tradeLostValue?.[playerId] ?? 0;
  }
}
