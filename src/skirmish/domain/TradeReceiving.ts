import { marketDropCapacity, marketDropLimit, marketAcceptancePercent, TRADE_RULES } from "../content/Economy";
import { TICKS_PER_SECOND } from "../Protocol";

interface Budget { stack: number; units: number; tick: number }
/** Shared per owner/tile. Integer accounting makes interleaved land/sea receipts
 * and checkpoint continuation exact; untouched markets need no per-tick work. */
export class TradeReceiving {
  private readonly budgets = new Map<string, Budget>();
  static key(owner: number, tile: number): string { return `${owner}:${tile}`; }
  checkpoint(): [string, Budget][] { return structuredClone([...this.budgets]); }
  restore(saved: [string, Budget][] = []): void {
    this.budgets.clear();
    for (const [key, budget] of saved) this.budgets.set(key, structuredClone(budget));
  }
  private maximum(stack: number): number {
    return marketDropCapacity(stack) * TRADE_RULES.seaDropMultiplier * TRADE_RULES.receivingUnitsPerGood;
  }
  private balance(b: Budget, tick: number): number {
    return Math.min(this.maximum(b.stack), b.units + Math.max(0, tick - b.tick) * b.stack *
      TRADE_RULES.receivingGoodsPerSecondPerBuilding * TRADE_RULES.receivingUnitsPerGood / TICKS_PER_SECOND);
  }
  configure(key: string, stack: number, tick: number): void {
    stack = Math.max(1, Math.min(10, stack));
    const b = this.budgets.get(key);
    if (!b) this.budgets.set(key, { stack, units: this.maximum(stack), tick });
    else if (b.stack !== stack) this.budgets.set(key,
      { stack, units: Math.min(this.maximum(stack), this.balance(b, tick)), tick });
  }
  retain(keys: ReadonlySet<string>): void {
    for (const key of this.budgets.keys()) if (!keys.has(key)) this.budgets.delete(key);
  }
  available(key: string, tick: number, naval: boolean, foreign: boolean, allied: boolean): number {
    const b = this.budgets.get(key);
    if (!b) return 0;
    const cost = TRADE_RULES.receivingUnitsPerGood * 100 / marketAcceptancePercent(foreign, allied);
    return Math.min(marketDropLimit(b.stack, naval, foreign, allied), Math.floor(this.balance(b, tick) / cost));
  }
  take(key: string, tick: number, cargo: number, naval: boolean, foreign: boolean, allied: boolean): number {
    const b = this.budgets.get(key);
    if (!b) return 0;
    const quantity = Math.min(Math.max(0, Math.floor(cargo)), this.available(key, tick, naval, foreign, allied));
    b.units = this.balance(b, tick) - quantity * TRADE_RULES.receivingUnitsPerGood * 100 /
      marketAcceptancePercent(foreign, allied);
    b.tick = tick;
    return quantity;
  }
}
