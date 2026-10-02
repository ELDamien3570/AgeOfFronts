interface LossHistory {
  last: number;
  samples: { tick: number; deaths: number }[];
}
/** Bounded recent casualties, rather than an ever-growing lifetime replacement
 * quota. Sampling/expiry uses simulation ticks and survives checkpoints.
 */
export class AiLossWindow {
  private readonly players = new Map<number, LossHistory>();
  sample(playerId: number, tick: number, lifetimeDeaths: number): number {
    let history = this.players.get(playerId);
    if (!history) {
      history = { last: lifetimeDeaths, samples: [] };
      this.players.set(playerId, history);
    }
    const deaths = Math.max(0, lifetimeDeaths - history.last);
    history.last = lifetimeDeaths;
    history.samples = history.samples.filter((s) => tick - s.tick < 2400);
    if (deaths) {
      const bucket = Math.floor(tick / 50) * 50;
      const last = history.samples[history.samples.length - 1];
      if (last?.tick === bucket) last.deaths += deaths;
      else history.samples.push({ tick: bucket, deaths });
    }
    // Fixed 50-tick bins retain at most 48 entries. Pressure expires at most
    // 49 ticks early; old deaths never roll forward into a younger bucket.
    return history.samples.reduce((n, s) => n + s.deaths, 0);
  }
  release(playerId: number): void {
    this.players.delete(playerId);
  }
  checkpoint() {
    return structuredClone([...this.players]);
  }
  restore(saved: ReturnType<AiLossWindow["checkpoint"]>): void {
    this.players.clear();
    for (const [id, history] of structuredClone(saved))
      this.players.set(id, history);
  }
}
