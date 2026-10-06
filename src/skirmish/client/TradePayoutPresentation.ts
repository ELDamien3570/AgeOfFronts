import type { TradeReceipt } from "../domain/Definitions";
/** Client-time lifetime; a new receipt replaces the old label at that location. */
export class TradePayoutPresentation {
  reset(): void {
    this.seen.clear();
    this.labels.clear();
  }
  private readonly seen = new Map<number, number>();
  private readonly labels = new Map<
    number,
    { gold: number; expires: number }
  >();
  update(
    receipts: readonly TradeReceipt[],
    playerId: number,
    now: number,
  ): void {
    const live = new Set<number>();
    for (const receipt of receipts) {
      if (receipt.playerId !== playerId) continue;
      live.add(receipt.tile);
      if (this.seen.get(receipt.tile) === receipt.id) continue;
      this.seen.set(receipt.tile, receipt.id);
      this.labels.set(receipt.tile, {
        gold: receipt.gold,
        expires: now + 2000,
      });
    }
    for (const tile of this.seen.keys())
      if (!live.has(tile)) this.seen.delete(tile);
  }
  amount(tile: number, now: number): number | undefined {
    const row = this.labels.get(tile);
    if (row && row.expires <= now) {
      this.labels.delete(tile);
      return undefined;
    }
    return row?.gold;
  }
  prune(now: number): void {
    for (const [tile, row] of this.labels)
      if (row.expires <= now) this.labels.delete(tile);
  }
}
