import { TRADE_RULES, WATER_TRADE_PRICING } from "../content/Economy";
import { FIXED } from "../Protocol";
export interface SeaPricing {
  routeTiles?: number;
  seaSpeed?: number;
  referenceCargoRatio?: number;
}
/** Pay for a single validated outward route, with a bounded distance credit. */
export function seaIncomeFactor(
  input: SeaPricing & { distance: number; mapWidth?: number },
): number {
  const width = Math.max(1, input.mapWidth ?? 500),
    distance = Math.max(0, input.distance);
  const route = Math.min(
    width * 2,
    Math.max(distance, input.routeTiles ?? distance),
  );
  const landRadius = Math.max(
    TRADE_RULES.minimumLandMarketRadius,
    (width * TRADE_RULES.landMarketWidthPercent) / 100,
  );
  const landCycle = 60 + (2 * landRadius * FIXED) / 50;
  const seaCycle = 60 + (2 * route * FIXED) / Math.max(1, input.seaSpeed ?? 70);
  const premium =
    (WATER_TRADE_PRICING.shortRatePercent +
      (WATER_TRADE_PRICING.longRatePercent -
        WATER_TRADE_PRICING.shortRatePercent) *
        Math.min(
          1,
          distance / ((width * WATER_TRADE_PRICING.longWidthPercent) / 100),
        )) /
    100;
  const taper = Math.min(
    1,
    distance / ((width * WATER_TRADE_PRICING.baseWidthPercent) / 100),
  );
  return (
    (premium * taper * (input.referenceCargoRatio ?? 1) * seaCycle) / landCycle
  );
}

/** The settlement formula is also the planner's payout authority. */
export function tradePayout(
  input: {
    naval: boolean;
    quantity: number;
    valuePerGood: number;
    distance: number;
    foreign: boolean;
    allied: boolean;
    mapWidth?: number;
  } & SeaPricing,
): number {
  if (input.quantity <= 0 || (input.naval && !input.foreign)) return 0;
  const percent = input.foreign
    ? input.allied
      ? TRADE_RULES.alliedPercent
      : TRADE_RULES.foreignPercent
    : TRADE_RULES.selfPercent;
  const distanceFactor = input.naval ? 100 * seaIncomeFactor(input) : 100;
  return Math.max(
    input.naval ? 1 : 0,
    Math.floor(
      (input.quantity * input.valuePerGood * percent * distanceFactor) / 10000,
    ),
  );
}

export interface TradeCycleQuote {
  quantity: number;
  delivered: number;
  returned: number;
  guaranteedGold: number;
  supplyTicks: number;
  handlingTicks: number;
  travelTicks: number;
  cycleTicks: number;
  goldPer1000Ticks: number;
  observedRisk: number;
  riskAdjustedGoldPer1000Ticks: number;
}
/** One pricing contract for execution and investment. Risk is an observation,
 * separate from guaranteed costs and settlement; it never creates currency. */
export function tradeCycleQuote(
  input: {
    naval: boolean;
    stock: number;
    capacity: number;
    valuePerGood: number;
    supplyTicks: number;
    legs: readonly {
      marketId: number;
      distance: number;
      foreign: boolean;
      allied: boolean;
      travelTicks: number;
      routeTiles?: number;
    }[];
    returnTicks: number;
    observedRisk: number;
    mapWidth?: number;
  } & SeaPricing,
): TradeCycleQuote {
  const quantity = Math.max(0, Math.min(input.stock, input.capacity));
  let left = quantity,
    guaranteedGold = 0,
    delivered = 0,
    outwardTicks = 0;
  const visited = new Set<number>();
  for (const leg of input.legs) {
    if (visited.has(leg.marketId) || (input.naval && !leg.foreign)) continue;
    visited.add(leg.marketId);
    const count = left;
    guaranteedGold += tradePayout({
      ...leg,
      naval: input.naval,
      quantity: count,
      valuePerGood: input.valuePerGood,
      mapWidth: input.mapWidth,
      seaSpeed: input.seaSpeed,
      referenceCargoRatio: input.referenceCargoRatio,
    });
    delivered += count;
    left -= count;
    outwardTicks += Math.max(0, leg.travelTicks);
    if (!left) break;
  }
  const handlingTicks = 40 + visited.size * 20;
  const travelTicks = Math.max(0, input.returnTicks) + outwardTicks;
  const cycleTicks = Math.max(
    1,
    input.supplyTicks + handlingTicks + travelTicks,
  );
  const goldPer1000Ticks = Math.floor((guaranteedGold * 1000) / cycleTicks);
  const observedRisk = Math.max(0, Math.min(1000, input.observedRisk));
  return {
    quantity,
    delivered,
    returned: left,
    guaranteedGold,
    supplyTicks: input.supplyTicks,
    handlingTicks,
    travelTicks,
    cycleTicks,
    goldPer1000Ticks,
    observedRisk,
    riskAdjustedGoldPer1000Ticks: Math.floor(
      (goldPer1000Ticks * (1000 - observedRisk)) / 1000,
    ),
  };
}
