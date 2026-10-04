import type { Player } from "../Protocol";
import type { Cost } from "./Definitions";

type GoldAccount = Pick<Player, "gold"> &
  Partial<Pick<Player, "ai" | "infiniteGold">>;
/** Keep authoritative balances finite; unlimited purchasing is a human match rule. */
export function hasInfiniteGold(player: GoldAccount): boolean {
  return player.infiniteGold === true && player.ai !== true;
}
export function availableGold(player: GoldAccount): number {
  return hasInfiniteGold(player) ? Infinity : player.gold;
}
export function spendGold(player: GoldAccount, amount: number): void {
  if (!hasInfiniteGold(player)) player.gold -= amount;
}
/** Refund only gold actually paid when a recruitment job is cancelled. */
export function paidCost(player: GoldAccount, cost: Cost): Cost {
  return hasInfiniteGold(player) ? { ...cost, gold: 0 } : cost;
}
