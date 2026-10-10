import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";
import type { TradeCycleQuote } from "./TradeQuote";

/** Production is worth expanding only when a sold-out route spends a material
 * part of its cycle waiting for a full load, and current stock still confirms it. */
export function tradeSupplyLimited(quote: TradeCycleQuote, source: {stock:number;capacity:number} | undefined): boolean {
  return !!source && quote.riskAdjustedGoldPer1000Ticks > 0 && quote.returned === 0 &&
    quote.supplyTicks >= Math.max(20,quote.cycleTicks / 4) && source.stock < source.capacity;
}

interface Evidence {
  source: number;
  market: number;
  sea?: number;
  quote: TradeCycleQuote;
  tick: number;
  generation: number;
}
/** Naval investment observes completed courier trips. It never starts a second
 * set of supply, risk or multi-stop route searches beside civilian trade. */
export class AiTradeOpportunities {
  private readonly evidence = new Map<string, Evidence>();
  private cursor = 0;
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      evidence: [...this.evidence],
      cursor: this.cursor,
    });
  }
  restore(saved?: ReturnType<AiTradeOpportunities["checkpoint"]>): void {
    this.evidence.clear();
    this.cursor = saved?.cursor ?? 0;
    for (const [key, row] of saved?.evidence ?? [])
      this.evidence.set(key, structuredClone(row));
  }
  release(playerId: number): void {
    this.evidence.delete(`${playerId}:true`);
    this.evidence.delete(`${playerId}:false`);
  }
  best(playerId: number, naval: boolean): Evidence | undefined {
    const row = this.evidence.get(`${playerId}:${naval}`),
      { world, trade } = this.expansion;
    if (
      !row ||
      world.tick - row.tick > 600 ||
      row.generation !== world.aiGeneration(playerId)
    )
      return undefined;
    const source = world.building(row.source),
      market = world.building(row.market);
    return source &&
      market &&
      source.playerId === playerId &&
      !source.remainingTicks &&
      !market.remainingTicks &&
      (source.health ?? 1) > 0 &&
      (market.health ?? 1) > 0 &&
      trade.permitted(playerId, market.playerId, naval)
      ? row
      : undefined;
  }
  step(budget = 8): number {
    const { trade, world } = this.expansion,
      actors = trade.actors;
    if (!world.options?.deferredPlanning || !actors.length) return 0;
    let used = 0;
    while (used < Math.min(budget, actors.length)) {
      const actor = actors[this.cursor++ % actors.length];
      used++;
      const player = world.players.find((p) => p.id === actor.playerId),
        quote = trade.cycleQuotes.get(actor.id),
        market = quote?.marketId ?? actor.visited[0];
      if (
        !player ||
        !this.economy.enabled(player) ||
        !quote ||
        quote.completedTick === undefined || world.tick - quote.completedTick > 600 ||
        market === undefined ||
        actor.state === "prize"
      )
        continue;
      const key = `${player.id}:${actor.naval}`,
        previous = this.evidence.get(key);
      if (
        previous &&
        world.tick - previous.tick < 600 &&
        previous.quote.goldPer1000Ticks > quote.goldPer1000Ticks
      )
        continue;
      this.evidence.set(key, {
        source: quote.sourceId ?? actor.factoryId,
        market,
        quote,
        tick: quote.completedTick,
        generation: world.aiGeneration(player.id),
        sea: actor.naval
          ? world.waterPaths.component[world.tileOf(actor)]
          : undefined,
      });
    }
    return used;
  }
}
