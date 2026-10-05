import { AGES, type Age } from "../domain/Definitions";

// Shared opening and growth rules used by simulation and presentation.
export const STARTING_AGE_TROOPS = 6_000;
export const LAND_TRADE_CAPACITIES = [20, 30, 40, 50, 60, 80, 120] as const;
export const tradeStockPerSecond = (age: Age) => 2 * (AGES.indexOf(age) + 1);
export const extractionYieldMultiplier = (age: Age) => 1 + Math.floor(AGES.indexOf(age) / 2);
export const TRADE_RULES = {
  actorCap: 48,
  spawnCooldownTicks: 400,
  maximumStack: 10,
  baseCargoPercent: 100,
  maximumCargoPercent: 300,
  cargoExponent: 0.5,
  valuePerGood: 10,
  selfPercent: 100,
  alliedPercent: 200,
  foreignPercent: 400,
  landMarketWidthPercent: 5,
  minimumLandMarketRadius: 12,
} as const;
export function stackCargoPercent(level: number): number {
  // Diminishing gains: 1x at one building, 3x at ten; never exponential.
  return Math.round(
    TRADE_RULES.baseCargoPercent +
      (TRADE_RULES.maximumCargoPercent - TRADE_RULES.baseCargoPercent) *
        ((Math.max(1, Math.min(TRADE_RULES.maximumStack, level)) - 1) /
          (TRADE_RULES.maximumStack - 1)) **
          TRADE_RULES.cargoExponent,
  );
}
// Successful long voyages earn 1.5x equivalent land income per cycle.
// Short crossings taper; capture and fleet costs reduce actual income.
export const WATER_TRADE_PRICING = {
  baseWidthPercent: 1,
  longWidthPercent: 10,
  shortRatePercent: 75,
  longRatePercent: 150,
} as const;
export const RESERVE_GROWTH = {
  base: [12, 18, 26, 36, 48, 64, 80],
  city: [8, 12, 18, 26, 36, 50, 70],
} as const;
export const baseReserveIncome = (age: Age) =>
  RESERVE_GROWTH.base[AGES.indexOf(age)];
export const cityReserveIncome = (age: Age) =>
  RESERVE_GROWTH.city[AGES.indexOf(age)];
