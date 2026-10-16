import { secondsToTicks } from "../Protocol";
import { marketDropCapacity, marketDropLimit, TRADE_RULES } from "../content/Economy";

/** Owner decision OD-4 (05 issue 4 / rec 3): a market accepts at most one
 * largest foreign visit of FOREIGN goods per this window (intakeBudget),
 * refilled continuously. The notes' example was marketDropCapacity(stack) per
 * 20 s, which is below the authored foreign and sea per-visit allowances and
 * would cut every first visit; domestic deliveries are exempt (issue 4 is
 * about foreign income). Per-visit limits still apply. */
export const MARKET_INTAKE_WINDOW_SECONDS = 20;
const WINDOW_TICKS = secondsToTicks(MARKET_INTAKE_WINDOW_SECONDS);

// Legacy units/tick fields are accepted on restore but ignored (they belonged
// to an older shared receiving rate). intake/intakeTick hold the foreign-goods
// budget used (in goods x window ticks) and the tick it was last updated.
interface Market { stack: number; percent?:number; units?: number; tick?: number; intake?: number; intakeTick?: number }
/** Per-visit limits by physical market. The shipment's visitedTiles enforces
 * one delivery per location until reload; other traders never consume its limit. */
export class TradeReceiving {
  private readonly markets = new Map<string, Market>();
  static key(owner: number, tile: number): string { return `${owner}:${tile}`; }
  checkpoint(): [string, Market][] { return structuredClone([...this.markets]); }
  restore(saved: [string, Market][] = []): void {
    this.markets.clear();
    for (const [key, market] of saved) {
      const restored: Market = { stack: market.stack, percent: market.percent ?? 100 };
      if (market.intake) { restored.intake = market.intake; restored.intakeTick = market.intakeTick ?? 0; }
      this.markets.set(key, restored);
    }
  }
  configure(key: string, stack: number, _tick: number,percent=100): void {
    stack = Math.max(1, Math.min(TRADE_RULES.maximumStack, stack));
    const market = this.markets.get(key);
    if (market?.stack !== stack || market?.percent!==percent) {
      const next: Market = { stack, percent };
      if (market?.intake) { next.intake = market.intake; next.intakeTick = market.intakeTick ?? 0; }
      this.markets.set(key, next);
    }
  }
  retain(keys: ReadonlySet<string>): void {
    for (const key of this.markets.keys()) if (!keys.has(key)) this.markets.delete(key);
  }
  status(key: string, _tick: number): { value: number; max: number } | undefined {
    const market = this.markets.get(key);
    return market && { value: Math.round(marketDropCapacity(market.stack)*(market.percent??100)/100),
      max: Math.round(marketDropCapacity(TRADE_RULES.maximumStack)*(market.percent??100)/100) };
  }
  /** Foreign goods a market accepts per window: one largest single foreign
   * visit (a sea trader at the foreign acceptance), so a fresh market still
   * takes any one delivery in full and repeated deliveries saturate it. */
  static intakeBudget(market: Pick<Market, "stack" | "percent">): number {
    return Math.round(marketDropLimit(market.stack, true, true, false) * (market.percent ?? 100) / 100);
  }
  /** Budget used after continuous refill up to `tick`, in goods x window ticks
   * so refill is exact integer arithmetic (budget per tick); pure. */
  private static used(market: Market, tick: number): number {
    const used = market.intake ?? 0;
    if (used <= 0) return 0;
    const elapsed = Math.max(0, tick - (market.intakeTick ?? tick));
    return Math.max(0, used - elapsed * TradeReceiving.intakeBudget(market));
  }
  available(key: string, tick: number, naval: boolean, foreign: boolean, allied: boolean): number {
    const market = this.markets.get(key);
    if (!market) return 0;
    const perVisit = Math.round(marketDropLimit(market.stack, naval, foreign, allied)*(market.percent??100)/100);
    if (!foreign) return perVisit;
    const free = TradeReceiving.intakeBudget(market) * WINDOW_TICKS - TradeReceiving.used(market, tick);
    return Math.max(0, Math.min(perVisit, Math.floor(free / WINDOW_TICKS)));
  }
  take(key: string, tick: number, cargo: number, naval: boolean, foreign: boolean, allied: boolean): number {
    const quantity = Math.min(Math.max(0, Math.floor(cargo)), this.available(key, tick, naval, foreign, allied));
    const market = this.markets.get(key);
    if (foreign && market && quantity > 0) {
      market.intake = TradeReceiving.used(market, tick) + quantity * WINDOW_TICKS;
      market.intakeTick = tick;
    }
    return quantity;
  }
}
