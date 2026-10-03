import { WATER_TRADE_PRICING } from "../content/Economy";

/** The settlement formula is also the planner's payout authority. */
export function tradePayout(input: {
  naval: boolean;
  quantity: number;
  valuePerGood: number;
  distance: number;
  foreign: boolean;
  allied: boolean;
}): number {
  if (input.naval && !input.foreign) return 0;
  const percent = input.allied ? 350 : input.foreign ? 250 : 100;
  const distance = Math.max(0, Math.floor(input.distance));
  const distanceFactor = input.naval
    ? Math.min(
        WATER_TRADE_PRICING.maximumPercent,
        distance * WATER_TRADE_PRICING.percentPerTile,
      )
    : 100 + Math.min(100, distance);
  return Math.floor(
    (input.quantity * input.valuePerGood * percent * distanceFactor) / 10000,
  );
}

export interface TradeCycleQuote {
  quantity: number; delivered: number; returned: number; guaranteedGold: number;
  supplyTicks: number; handlingTicks: number; travelTicks: number; cycleTicks: number;
  goldPer1000Ticks: number; observedRisk: number; riskAdjustedGoldPer1000Ticks: number;
}
/** One pricing contract for execution and investment. Risk is an observation,
 * separate from guaranteed costs and settlement; it never creates currency. */
export function tradeCycleQuote(input: {
  naval: boolean; stock: number; capacity: number; valuePerGood: number; supplyTicks: number;
  legs: readonly { marketId: number; distance: number; foreign: boolean; allied: boolean; travelTicks: number }[];
  returnTicks: number; observedRisk: number;
}): TradeCycleQuote {
  const quantity = Math.max(0, Math.min(input.stock, input.capacity));
  let left = quantity, guaranteedGold = 0, delivered = 0;
  const visited = new Set<number>();
  for (const leg of input.legs) {
    if (visited.has(leg.marketId) || (input.naval && !leg.foreign)) continue;
    visited.add(leg.marketId);
    const count = Math.min(10, left);
    guaranteedGold += tradePayout({ ...leg, naval: input.naval, quantity: count, valuePerGood: input.valuePerGood });
    delivered += count; left -= count;
  }
  const handlingTicks = 40 + visited.size * 20;
  const travelTicks = Math.max(0, input.returnTicks) + input.legs.reduce((n, l) => n + Math.max(0, l.travelTicks), 0);
  const cycleTicks = Math.max(1, input.supplyTicks + handlingTicks + travelTicks);
  const goldPer1000Ticks = Math.floor(guaranteedGold * 1000 / cycleTicks);
  const observedRisk = Math.max(0, Math.min(1000, input.observedRisk));
  return { quantity, delivered, returned: left, guaranteedGold, supplyTicks: input.supplyTicks,
    handlingTicks, travelTicks, cycleTicks, goldPer1000Ticks, observedRisk,
    riskAdjustedGoldPer1000Ticks: Math.floor(goldPer1000Ticks * (1000 - observedRisk) / 1000) };
}
