import { AGES, type Age } from "../domain/Definitions";

// Shared opening and growth rules used by simulation and presentation.
export const STARTING_AGE_TROOPS = 6_000;
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
// Below one percent of map width, income tapers linearly. Long voyages
// reach at most three times base income at twenty-five percent of map width.
export const WATER_TRADE_PRICING = {
  baseWidthPercent: 1,
  maximumWidthPercent: 25,
  maximumPercent: 300,
} as const;
export const RESERVE_GROWTH = {
  base: [12, 18, 26, 36, 48, 64, 80],
  city: [8, 12, 18, 26, 36, 50, 70],
} as const;
export const baseReserveIncome = (age: Age) =>
  RESERVE_GROWTH.base[AGES.indexOf(age)];
export const cityReserveIncome = (age: Age) =>
  RESERVE_GROWTH.city[AGES.indexOf(age)];
