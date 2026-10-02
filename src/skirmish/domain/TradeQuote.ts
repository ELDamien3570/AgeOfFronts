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
