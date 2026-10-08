import { marketDropCapacity, marketDropLimit, TRADE_RULES } from "../content/Economy";

// Legacy units/tick fields are accepted on restore, but no longer limit intake.
interface Market { stack: number; units?: number; tick?: number }
/** Per-visit limits by physical market. The shipment's visitedTiles enforces
 * one delivery per location until reload; other traders never consume its limit. */
export class TradeReceiving {
  private readonly markets = new Map<string, Market>();
  static key(owner: number, tile: number): string { return `${owner}:${tile}`; }
  checkpoint(): [string, Market][] { return structuredClone([...this.markets]); }
  restore(saved: [string, Market][] = []): void {
    this.markets.clear();
    for (const [key, market] of saved) this.markets.set(key, { stack: market.stack });
  }
  configure(key: string, stack: number, _tick: number): void {
    stack = Math.max(1, Math.min(TRADE_RULES.maximumStack, stack));
    if (this.markets.get(key)?.stack !== stack) this.markets.set(key, { stack });
  }
  retain(keys: ReadonlySet<string>): void {
    for (const key of this.markets.keys()) if (!keys.has(key)) this.markets.delete(key);
  }
  status(key: string, _tick: number): { value: number; max: number } | undefined {
    const market = this.markets.get(key);
    return market && { value: marketDropCapacity(market.stack),
      max: marketDropCapacity(TRADE_RULES.maximumStack) };
  }
  available(key: string, _tick: number, naval: boolean, foreign: boolean, allied: boolean): number {
    const market = this.markets.get(key);
    return market ? marketDropLimit(market.stack, naval, foreign, allied) : 0;
  }
  take(key: string, tick: number, cargo: number, naval: boolean, foreign: boolean, allied: boolean): number {
    return Math.min(Math.max(0, Math.floor(cargo)), this.available(key, tick, naval, foreign, allied));
  }
}
